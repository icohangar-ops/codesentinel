# Streamable HTTP MCP (remote / Glama)

CodeSentinel speaks MCP over **stdio** (local clients) and **Streamable HTTP**
(public HTTPS). Glama remote connectors require the latter: a public HTTPS URL
that implements `streamable-http`.

This process is a durable Node HTTP server. Do **not** invent a hostname here —
set `HOST` / `PORT` / `MCP_HTTP_HOST` from your platform.

## Local run

```bash
export MCP_BEARER_TOKEN="replace-with-a-long-random-secret"
npm run mcp:http
# GET http://127.0.0.1:8787/health
# POST http://127.0.0.1:8787/mcp  Authorization: Bearer <token>
```

Stdio is unchanged:

```bash
npm run mcp:start
```

Smoke both health and `initialize`:

```bash
MCP_BEARER_TOKEN="replace-with-a-long-random-secret" npm run mcp:http:smoke
```

## Auth (fail-closed)

| Condition | Result |
|-----------|--------|
| `MCP_BEARER_TOKEN` unset at process start | Process exits; nothing listens |
| Missing / invalid `Authorization` on `/mcp` | HTTP 401 + `WWW-Authenticate: Bearer` |
| Valid `Bearer` token | Streamable HTTP JSON-RPC |

`/health` and `/healthz` are liveness only. They do not list tools and do not
echo `LLM_API_KEY`, `MCP_BEARER_TOKEN`, or other secrets.

## Stateless multi-replica

HTTP mode uses `StreamableHTTPServerTransport` with `sessionIdGenerator: undefined`
and a **new server + transport per POST**. There is no in-memory `Mcp-Session-Id`
map, so replicas behind a load balancer do not need sticky sessions.

`GET /mcp` and `DELETE /mcp` return 405 (no standalone SSE session). Tool calls
are request/response. Default `enableJsonResponse=true` avoids idle SSE timeouts
on proxies. Set `MCP_HTTP_JSON_RESPONSE=0` if you want SSE-streamed responses.

If you later enable stateful sessions or `GET /mcp` SSE, pin those streams
(sticky cookies / `Mcp-Session-Id` affinity) or share an event store.

## Hosting

Pick a platform that runs a **long-lived Node process** and terminates TLS.

### Fly.io (recommended)

```bash
fly launch --no-deploy   # creates an app name; do not hardcode a public URL in git
fly secrets set MCP_BEARER_TOKEN="..." LLM_API_KEY="..."
fly deploy
```

`fly.toml` binds `PORT` (default 8787). Fly provides `https://<your-app>.fly.dev`.
Use that hostname as `MCP_HTTP_HOST` in client / Glama / `server.json` remotes.

Keep at least one machine running (`min_machines_running = 1`) so the first
handshake is not a cold start. Auto-stop is OK for JSON request/response but
hurts first-byte latency.

### Railway

1. New service from this repo.
2. Start command: `node mcp-server/http.js`
3. Railway injects `PORT`. The server binds `0.0.0.0` when `PORT` is set.
4. Set `MCP_BEARER_TOKEN` (required) and optional `LLM_API_KEY` / `DAYTONA_API_KEY`.
5. Public URL is whatever Railway assigns — put that host in client config.

### Docker

```bash
docker build -t codesentinel-mcp .
docker run --rm -p 8787:8787 \
  -e MCP_BEARER_TOKEN="..." \
  -e LLM_API_KEY="..." \
  codesentinel-mcp
```

Put a TLS proxy (Caddy, Fly, Railway, nginx) in front. Clients and Glama need
**HTTPS** on the public URL.

### Vercel / serverless — do not use

Vercel Functions, AWS Lambda, and similar request isolates are a poor fit:

- Streamable HTTP is a Node HTTP server that may stream `text/event-stream`
- Platform timeouts and buffering break SSE and long tool calls
- There is no durable listen socket

Use Fly, Railway, or any Docker/VM host instead.

## Environment

| Variable | Required | Purpose |
|----------|----------|---------|
| `MCP_BEARER_TOKEN` | HTTP yes | Shared secret; fail-closed |
| `MCP_HTTP_HOST` / `HOST` | no | Bind address (`127.0.0.1` local, `0.0.0.0` in containers) |
| `MCP_HTTP_PORT` / `PORT` | no | Listen port (default `8787`) |
| `MCP_HTTP_PATH` | no | MCP path (default `/mcp`) |
| `MCP_HTTP_JSON_RESPONSE` | no | `1` (default) JSON bodies; `0` SSE streams |
| `MCP_ALLOWED_HOSTS` | no | Comma-separated `Host` allowlist |
| `MCP_HTTP_CORS_ORIGINS` | no | Comma-separated origins; default `*` for browser inspectors |
| `LLM_API_KEY` / provider keys | no | Server-side only; never returned |

## Glama connector

On [Glama](https://glama.ai/mcp/faq) → Add MCP Server → **Connector**:

1. Name / description for CodeSentinel.
2. Server URL: `https://$MCP_HTTP_HOST/mcp` (your deployed HTTPS host).
3. Transport is **streamable-http** (not stdio, not legacy SSE-only).
4. Test credentials: API Key / Bearer matching `MCP_BEARER_TOKEN` so Glama's
   health check can run `initialize` + `tools/list`.
5. Auth badge: API Key (not “No Auth”). Unauthenticated `/mcp` is 401 by design.

Stdio remains the npm package install for local Claude Desktop / Cursor.
