/* Cloudflare Worker - Wildcard DNS Proxy to Google Cloud Run */

addEventListener("fetch", (event) => {
  event.respondWith(handleRequest(event.request, event));
});

async function handleRequest(request, event) {
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

    // Forward the request with the same method and body
    const fetchOptions = {
      method: request.method,
      headers: headers,
      redirect: "manual",
    };

    // Include body for POST, PUT, PATCH requests
    if (request.method !== "GET" && request.method !== "HEAD") {
      fetchOptions.body = request.body;
    }

    const response = await fetch(targetUrl.toString(), fetchOptions);

    // Create response headers, preserving Set-Cookie headers
    const responseHeaders = new Headers(response.headers);

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error("Proxy error:", error.message);
    return new Response("Bad Gateway", { status: 502 });
  }
}
