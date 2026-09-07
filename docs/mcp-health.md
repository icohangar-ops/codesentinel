# MCP protocol health vs HTTP uptime

A remote MCP URL that returns **HTTP 200** is not a healthy MCP server.

Load balancers, reverse proxies, and status pages answer TCP and HTTP. The Model
Context Protocol does not. Agents fail later, often after tool descriptions have
already been pulled into context, when:

- `initialize` returns HTML, an empty body, or a JSON-RPC error
- the Streamable HTTP POST is 200 but the SSE stream never yields a result
- Starlette/Uvicorn exception handlers swallow a `tools/call` and still return 200
- FastMCP Streamable HTTP clients get 400/406 with little signal (wrong Accept,
  missing `Mcp-Session-Id`, GET vs POST, sticky-session mismatch)
- `tools/list` is missing, malformed, or a different schema than last week
- a tool description embeds a token, key, or connection string

CodeSentinel treats those as **protocol** failures, not uptime failures.

## What this check does

1. **Synthetic handshake** — `initialize` → `notifications/initialized` →
   `tools/list` over Streamable HTTP. Legacy HTTP+SSE is used when the
   Streamable HTTP POST is 404/405/406 (or when you pass `--transport sse`).
2. **Silent-exception / error-shape probe** — force a known-bad `tools/call`
   (nonexistent tool `__codesentinel_silent_probe_nonexistent__`) and require a
   JSON-RPC error with integer `code` and a non-empty `message`. HTTP 200 with
   an empty body, HTML, a success `result`, or a malformed error is
   `silent_exception` / `malformed_rpc_error`.
3. **Streamable HTTP diagnostic matrix** — deliberately wrong method, Accept,
   session header, GET vs POST `/mcp`, and a fake session id. Matched
   rejections are diagnostics with reason codes, not critical alarms. A 2xx
   empty/success body on those probes is still a silent failure.
4. **Canonical schema hash** — SHA-256 of tools sorted by name, with object
   keys sorted. Compare to a baseline to alarm on drift.
5. **Discovery latency** — `initializeMs`, `toolsListMs`, `handshakeMs`.
6. **Secret scan** — names, descriptions, and schema strings are scanned
   *before* they are treated as safe agent context. Matches are redacted.

`http.up` / `httpUp` means a 2xx status was observed. `protocolHealthy` means
both JSON-RPC results arrived. `ok` is false on any critical alarm
(handshake failure, swallowed error shape, or leaked secret).

## Streamable HTTP reason codes

| Code | Typical trigger | What to do |
|------|-----------------|------------|
| `WRONG_METHOD` | `PUT`/`PATCH` (or 405 on the message channel) | POST JSON-RPC. GET is SSE listen only. |
| `WRONG_ACCEPT` | 406 / `Client must accept text/event-stream` | Send `Accept: application/json, text/event-stream`. |
| `MISSING_SESSION` | 400 `Missing session ID` after initialize | Echo `Mcp-Session-Id`. `X-Session-ID` is ignored. |
| `GET_VS_POST` | GET `/mcp` with JSON Accept, or an HTML page | POST initialize/tools/*. GET is not the RPC channel. |
| `SESSION_STICKY_MISMATCH` | 400/404 `No valid session ID provided` | Sticky LB, no stale ids, reconnect after restart. |
| `SILENT_EXCEPTION` | HTTP 200 HTML / success for a known-bad call | Return a JSON-RPC `error` — do not swallow in Starlette. |
| `EMPTY_PROTOCOL` | HTTP 200 empty body | Emit `{ jsonrpc, id, error: { code, message } }`. |
| `MALFORMED_RPC_ERROR` | JSON without numeric `code` + message | Fix the error object to JSON-RPC 2.0. |

Handshake failures are classified with the same codes when the initialize
error matches. The matrix itself is also on the result as
`streamableHttp.probes[]` (`matched`, `silent`, `httpStatus`, `hint`).

## Entrypoints

This repo is CodeSentinel (codebase health), not a standalone MCP monitor.
Protocol health is mounted on the existing surfaces:

| Surface | How to call |
|---------|-------------|
| Library | `require("./src/lib/mcp-health").checkMcpHealth(url)` |
| Analyzer | `runAnalysis({ type: "mcp_health", mcpUrl })` |
| MCP tool | `check_mcp_health` (`endpoint`, optional `baseline_hash`, `include_probes`) |
| CLI | `npm run mcp:health -- https://host/mcp` |
| Slack | “mcp health”, “streamable http”, “silent mcp”, “mcp session” + a URL |
| Spec | `openspec/changes/mcp-health-silent-probes/` |

```bash
# Probe a remote server. Exit 1 if protocol-unhealthy, silent swallow, or secrets leak.
npm run mcp:health -- https://example.com/mcp

# Handshake / schema / secrets only
npm run mcp:health -- https://example.com/mcp --no-probes

# Alarm when tools/list drifts from a saved snapshot
npm run mcp:health -- https://example.com/mcp --baseline ./mcp-schema.json --write-baseline ./mcp-schema.json
```

Do not use this in place of Slack Socket Mode liveness or `app.js` process
health. Those answer “is CodeSentinel running?”. This answers “does that
remote MCP endpoint still speak MCP?”
