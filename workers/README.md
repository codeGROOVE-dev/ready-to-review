# Cloudflare Worker - Wildcard DNS Proxy

This Cloudflare Worker acts as a reverse proxy for wildcard DNS domains, forwarding all HTTP requests to a Google Cloud Run service while preserving the original hostname.

This is a workaround for the fact that Google Cloud Run doesn't support wildcard DNS, but Cloudflare workers do.

## Features

- **Original Hostname Preservation**: Adds `X-Original-Host` header
- **All HTTP Methods**: Supports GET, POST, PUT, PATCH, DELETE, etc.
- **Request Body Forwarding**: Properly forwards request bodies for POST/PUT/PATCH requests
- **Error Handling**: Returns 502 Bad Gateway on proxy errors

## Configuration

Edit `wrangler.toml` to set your Cloud Run service URL:

```toml
[env.production.vars]
TARGET_HOST = "your-cloud-run-service.run.app"
```

## Deployment

1. Install Wrangler CLI:
```bash
npm install -g wrangler
```

2. Authenticate:
```bash
wrangler login
```

3. Deploy to production:
```bash
cd workers
wrangler deploy --env production
```

4. Deploy to staging:
```bash
wrangler deploy --env staging
```

## Headers Added

- `X-Original-Host`: The original hostname requested by the client
- `Host`: Updated to Cloud Run service hostname

## Local Development

Test locally with Wrangler:
```bash
wrangler dev
```

This will start a local server at `http://localhost:8787`

## Monitoring

Monitor your worker at:
- Cloudflare Dashboard → Workers & Pages → dashboard-proxy
- View metrics, logs, and errors in real-time
