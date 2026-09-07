# Design: Streamable HTTP MCP

## Decision

Thin HTTP wrapper around the existing tool handlers. Extract `createMcpServer()`
so stdio and HTTP register the same tools. HTTP uses the official SDK
`StreamableHTTPServerTransport` in **stateless** mode.

## Why stateless

Stateful Streamable HTTP stores `Mcp-Session-Id` in the process that handled
`initialize`. A later request on another replica returns “session not found”.
Stateless mode (`sessionIdGenerator: undefined`) plus a **fresh server +
transport per POST** matches the SDK `simpleStatelessStreamableHttp` example
and is the pattern used by multi-replica MCP gateways.

If a future feature needs server-initiated SSE (`GET /mcp`) or resumable
streams, document sticky sessions or a shared event store. CodeSentinel tools
are request/response today, so stateless is the default.

`enableJsonResponse` defaults to **true** so proxies that buffer or idle-timeout
SSE do not break `initialize` / `tools/list`. Set `MCP_HTTP_JSON_RESPONSE=0` to
prefer SSE streams. Both are valid Streamable HTTP.

## Auth

- HTTP process **refuses to listen** if `MCP_BEARER_TOKEN` is missing/blank.
- Every `/mcp` request except CORS preflight requires `Authorization: Bearer <token>`.
- Compare tokens with `crypto.timingSafeEqual`.
- Missing or invalid → HTTP 401 + `WWW-Authenticate: Bearer`. Same body for both.
- `/health` and `/healthz` are unauthenticated liveness only (no tools, no secrets).

## Hosting

Vercel serverless is a poor fit (function timeouts, no durable Node HTTP,
SSE/streaming quirks). Ship a Dockerfile and Fly/Railway notes. Platforms
terminate TLS; the process binds `HOST`/`PORT` from env.

## server.json

Keep the npm stdio package. Add a `remotes` entry:

`https://{MCP_HTTP_HOST}/mcp` + required secret `Authorization` header.

No fabricated production hostname.
