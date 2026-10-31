import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import './index.css'
import './lib/networkDetail'

// Stale-chunk recovery: each deploy emits new hashed asset filenames. A tab
// opened before the deploy that lazy-loads a page afterwards requests the OLD
// filename ("Failed to fetch dynamically imported module" → blank "Something
// went wrong"). Reload once to boot the fresh bundle; the session guard stops
// reload loops if the network itself is down.
const CHUNK_RELOAD_KEY = 'ucs_chunk_reloaded'
const isChunkError = (msg) => /Failed to fetch dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk \d+ failed/i.test(String(msg || ''))
const reloadForChunk = () => {
  try {
    if (sessionStorage.getItem(CHUNK_RELOAD_KEY)) return
    sessionStorage.setItem(CHUNK_RELOAD_KEY, '1')
  } catch { /* storage unavailable — reload anyway */ }
  window.location.reload()
}
window.addEventListener('error', (e) => { if (isChunkError(e?.message)) reloadForChunk() }, true)
window.addEventListener('unhandledrejection', (e) => { if (isChunkError(e?.reason?.message || e?.reason)) reloadForChunk() })
try { sessionStorage.removeItem(CHUNK_RELOAD_KEY) } catch { /* ignore */ }

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
)
