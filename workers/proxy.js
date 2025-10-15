/* Cloudflare Worker - Wildcard DNS Proxy to Google Cloud Run */

addEventListener("fetch", (event) => {
  event.respondWith(handleRequest(event.request, event));
});

async function handleRequest(request, event) {
  // Only support GET requests
  if (request.method !== "GET") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "GET" },
    });
  }

  try {
    const url = new URL(request.url);
    const targetHost =
      event.env?.TARGET_HOST || "dashboard-919730087582.us-central1.run.app";
    const targetUrl = new URL(
      url.pathname + url.search,
      `https://${targetHost}`,
    );

    // Build headers with original hostname
    const headers = new Headers(request.headers);
    headers.set("X-Original-Host", url.hostname);
    headers.set("Host", targetHost);

    const response = await fetch(targetUrl.toString(), {
      method: "GET",
      headers: headers,
      redirect: "manual",
    });

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } catch (error) {
    console.error("Proxy error:", error.message);
    return new Response("Bad Gateway", { status: 502 });
  }
}
