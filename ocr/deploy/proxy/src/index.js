// Free Cloudflare Worker that gives a stable public URL for a local OCR service
// behind a Cloudflare Quick Tunnel. No domain required: the URL is
// https://<worker-name>.<your-subdomain>.workers.dev
//
// When the Quick Tunnel restarts its *.trycloudflare.com URL changes. Update
// TARGET_URL in wrangler.jsonc and redeploy this Worker; the public URL stays
// the same, so the Node backend never needs another change.

/** @param {Request} request @param {{ TARGET_URL: string }} env */
export default {
  async fetch(request, env) {
    const target = (env.TARGET_URL || "").trim();
    if (!target) {
      return new Response("TARGET_URL is not set in wrangler.jsonc", { status: 500 });
    }

    const incoming = new URL(request.url);
    const destination = new URL(incoming.pathname + incoming.search, target);

    const headers = new Headers(request.headers);
    headers.delete("host");

    /** @type {RequestInit} */
    const init = { method: request.method, headers, redirect: "manual" };
    if (!["GET", "HEAD"].includes(request.method)) {
      init.body = request.body;
    }

    let upstream;
    try {
      upstream = await fetch(destination.toString(), init);
    } catch (error) {
      return new Response(`OCR tunnel unreachable: ${String(error)}`, { status: 502 });
    }

    const responseHeaders = new Headers(upstream.headers);
    // The OCR service's ?key= bootstrap redirects using its own URL. Rewrite
    // that redirect back to this Worker so the stable URL is preserved.
    const location = responseHeaders.get("location");
    if (location && upstream.status >= 300 && upstream.status < 400) {
      responseHeaders.set("location", location.replace(target.replace(/\/+$/, ""), incoming.origin));
    }

    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  },
};
