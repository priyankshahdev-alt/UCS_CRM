// Cloudflare Worker that pings the Render OCR service so a Free web service
// never hits Render's 15-minute idle spin-down.
//
// Deploy with `npx wrangler deploy` from this folder. The cron runs every 10
// minutes (see wrangler.jsonc); `GET /ping` pings on demand for testing.

const USER_AGENT = "ucs-ocr-keepalive/1.0";
// Render's free wake-up takes about a minute; leave room for a slow OCR boot.
const PING_TIMEOUT_MS = 180_000;

async function ping(env) {
  const target = (env.TARGET_URL || "").trim();
  if (!target) {
    throw new Error("TARGET_URL is not set in wrangler.jsonc");
  }

  const headers = { "user-agent": USER_AGENT, accept: "application/json" };
  // /api/status is public; this only matters if you protect it later.
  if (env.OCR_API_KEY) headers["x-ocr-key"] = env.OCR_API_KEY;

  const started = Date.now();
  try {
    const response = await fetch(target, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(PING_TIMEOUT_MS),
    });
    await response.body?.cancel();
    return {
      ok: response.ok,
      status: response.status,
      ms: Date.now() - started,
      target,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      ms: Date.now() - started,
      target,
      error: String(error),
    };
  }
}

export default {
  async scheduled(controller, env) {
    const result = await ping(env);
    const line = JSON.stringify({ event: "keepalive", cron: controller.cron, ...result });
    if (result.ok) {
      console.log(line);
    } else {
      console.error(line);
    }
  },

  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/ping") {
      const result = await ping(env);
      return Response.json(result, { status: result.ok ? 200 : 502 });
    }
    return new Response(
      "ucs-ocr keepalive\n\nGET /ping to ping TARGET_URL now.\nThe cron trigger runs every 10 minutes.\n",
      { headers: { "content-type": "text/plain; charset=utf-8" } },
    );
  },
};
