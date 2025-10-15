# Cloudflare Worker - Wildcard DNS Proxy

This Cloudflare Worker acts as a reverse proxy for wildcard DNS domains, forwarding GET requests to a Google Cloud Run service while preserving the original hostname.

This is a crap workaround for the fact that Google doesn't support wildcard DNS, but Cloudflare workers do.

## Features

- **Original Hostname Preservation**: Adds `X-Original-Host` header
- **GET-only**: Only accepts GET requests for simplicity and security
- **Error Handling**: Returns 502 Bad Gateway on errors, 405 Method Not Allowed for non-GET requests

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
