# Streamable HTTP MCP (Vercel + Glama)

CodeSentinel speaks MCP over **stdio** (local clients) and **Streamable HTTP**
(public HTTPS). Glama remote connectors require the latter: a public HTTPS URL
that implements `streamable-http`.

HTTP mode is **stateless** (`sessionIdGenerator: undefined`, new server +
transport per POST, JSON responses by default). That matches Vercel’s
multi-instance model — no sticky sessions.

Do **not** invent a hostname. Use the platform URL (`VERCEL_PROJECT_PRODUCTION_URL`
or your Fly/Railway host).

## Local run

```bash
export MCP_BEARER_TOKEN="replace-with-a-long-random-secret"
npm run mcp:http
# GET http://127.0.0.1:8787/health
# POST http://127.0.0.1:8787/mcp  Authorization: Bearer <token>
```

Stdio is unchanged (`npm run mcp:start`). Smoke:

```bash
MCP_BEARER_TOKEN="replace-with-a-long-random-secret" npm run mcp:http:smoke
```

## Auth (fail-closed)

| Condition | Result |
|-----------|--------|
| `MCP_BEARER_TOKEN` unset at process start (Node listen) | Process exits; nothing listens |
| Missing / invalid `Authorization` on `/mcp` | HTTP 401 + `WWW-Authenticate: Bearer` |
| Valid `Bearer` token | Streamable HTTP JSON-RPC |

`/health` and `/healthz` are liveness only. They do not list tools and do not
echo `LLM_API_KEY`, `MCP_BEARER_TOKEN`, or other secrets.

## Deploy on Vercel (preferred)

`vercel.json` enables **Fluid Compute**, sets `outputDirectory` to `public`, and
rewrites `/mcp` + `/health` to a Node function (`api/index.mjs`) that uses the
Web Standard `Request`/`Response` API — not Express `app.listen()`. The Glama
claim is a real static file at `public/.well-known/glama.json` (no rewrite).
`GET /health` is unauthenticated liveness and must return 200 even when
`MCP_BEARER_TOKEN` is unset. `/mcp` stays fail-closed (401) if the token is
missing or invalid.

Why this works on Vercel:

- Each MCP POST is an independent JSON request/response (stateless).
- Fluid Compute streams if you ever disable JSON mode; default is JSON so
  proxies and function isolation stay simple.
- `GET /mcp` SSE sessions are **not** used (405). No sticky session map.

Why not a tiny Hobby isolate without Fluid: tool calls (repo scans) can exceed
short timeouts. `maxDuration` is 60s. Raise it on Pro if scans need longer.

```bash
npx vercel
npx vercel env add MCP_BEARER_TOKEN      # required
npx vercel env add LLM_API_KEY           # optional
npx vercel env add DAYTONA_API_KEY       # optional
npx vercel env add GITHUB_TOKEN          # optional, private clones
npx vercel --prod
```

| Env on Vercel | Required | Purpose |
|---------------|----------|---------|
| `MCP_BEARER_TOKEN` | yes | Shared secret; fail-closed on `/mcp` |
| `LLM_API_KEY` | no | Server-side only; never returned |
| `DEEPSEEK_API_KEY` / `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` | no | Provider keys (server-side) |
| `DAYTONA_API_KEY` | no | Isolated GitHub scans |
| `GITHUB_TOKEN` | no | Private repo fetch |
| `MCP_HTTP_PATH` | no | Default `/mcp` |

Public URLs (from Vercel, not this repo):

- MCP: `https://$VERCEL_PROJECT_PRODUCTION_URL/mcp`
- Health: `https://$VERCEL_PROJECT_PRODUCTION_URL/health`
- Glama claim (unauthenticated): `https://$VERCEL_PROJECT_PRODUCTION_URL/.well-known/glama.json`

Disable **Deployment Protection** (Vercel Authentication) on production.
Glama’s health check must reach `/mcp` with only your Bearer header.

## Glama connector — exact fields

After the Vercel production URL exists, Add MCP Server → **Connector**:

| Field | What to enter |
|-------|----------------|
| Name | CodeSentinel |
| Description | Codebase health: dead code, circular deps, coupling, drift |
| Server URL | `https://$VERCEL_PROJECT_PRODUCTION_URL/mcp` |
| Transport | `streamable-http` (not stdio, not legacy SSE) |
| Authentication | API Key |
| Header name | `Authorization` |
| Header value | `Bearer $MCP_BEARER_TOKEN` (same secret as the Vercel env) |
| Ownership claim | Static `public/.well-known/glama.json` at `/.well-known/glama.json` (no auth; not rewritten) |

Client snippet (replace the host from Vercel):

```json
{
  "mcpServers": {
    "codesentinel": {
      "type": "streamable-http",
      "url": "https://${VERCEL_PROJECT_PRODUCTION_URL}/mcp",
      "headers": {
        "Authorization": "Bearer ${MCP_BEARER_TOKEN}"
      }
    }
  }
}
```

## Stateless multi-replica

No in-memory `Mcp-Session-Id`. Any Vercel instance can serve `initialize`,
`tools/list`, or `tools/call`. `GET /mcp` and `DELETE /mcp` return 405.

`MCP_HTTP_JSON_RESPONSE=0` prefers SSE-streamed responses. Use that only on a
durable Node host (Docker/Fly). Vercel stays on JSON (default).

## Docker / Fly (fallback)

Use these if you need long SSE streams or scans longer than the Vercel
function budget.

```bash
docker build -t codesentinel-mcp .
docker run --rm -p 8787:8787 -e MCP_BEARER_TOKEN="..." codesentinel-mcp
```

Fly: `fly launch` / `fly secrets set MCP_BEARER_TOKEN=...` then `fly deploy`.
See `fly.toml`. Railway: start command `node mcp-server/http.js`, set `PORT`
and `MCP_BEARER_TOKEN`.
