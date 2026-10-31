import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'

// The API and the realtime listener usually run on another box on the LAN
// (e.g. 192.168.1.152) while the dev server runs here (192.168.1.154). Derive
// the proxy targets from the same variables the app itself reads, so /api,
// /uploads and /ws can never point at the wrong machine.
function originOf(value, fallback) {
  if (!value) return fallback
  try {
    return new URL(value).origin
  } catch {
    return fallback
  }
}

function wsOriginOf(value, fallback) {
  const origin = originOf(value, '')
  if (!origin) return fallback
  return origin.replace(/^ws/, 'http')
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, '')
  const apiTarget = originOf(env.VITE_API_URL, 'http://127.0.0.1:5000')
  const wsTarget = wsOriginOf(env.VITE_WS_URL, 'http://127.0.0.1:5001')

  return {
    base: '/',
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
        // The observance reference calendar is plain ESM with no Node dependencies,
        // so the client imports the very same module the server uses. One source of
        // truth means festival dates can never drift between the two.
        '@observances': path.resolve(__dirname, '../backend/src/utils/observances.js'),
      },
    },
    server: {
      // Listen on every interface, not just localhost, so phones and other
      // machines on the LAN can open http://192.168.1.154:5173.
      host: true,
      port: 5173,
      // Fail loudly instead of silently moving to 5174 - the LAN URL people
      // bookmark is http://192.168.1.154:5173 and must stay stable.
      strictPort: true,
      // Dev-only: accept whatever Host header the client used (LAN IPs, mDNS
      // names, tunnels). Vite otherwise rejects unknown hosts.
      allowedHosts: true,
      // Proxy API, uploaded chat media and the realtime upgrade to the backend
      // so relative URLs resolve when running the Vite dev server (port 5173).
      proxy: {
        '/api': { target: apiTarget, changeOrigin: true },
        '/uploads': { target: apiTarget, changeOrigin: true },
        '/ws': { target: wsTarget, ws: true, changeOrigin: true },
      },
      // The alias above points outside the client root, so the dev server must be
      // allowed to serve that file.
      fs: { allow: [path.resolve(__dirname, '..'), path.resolve(__dirname, '.')] },
    },
    build: {
      rollupOptions: {
        output: {
          // xlsx / jspdf / exceljs are only ever used behind click handlers in
          // already-lazy panel pages. Forcing them into named chunks made Rollup
          // add a static edge from the entry chunk, so every login downloaded
          // ~1.9 MB of export libraries no one had opened yet. Leaving them out
          // lets Rollup keep each library inside whichever lazy chunk needs it.
        },
      },
    },
  }
})
