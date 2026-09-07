# Design: Silent probes + Streamable HTTP reason codes

## Surfaces (unchanged)

| Surface | Entrypoint |
|---------|------------|
| Library | `src/lib/mcp-health.checkMcpHealth` |
| Analyzer | `lib/analyzers/mcp-health.js` |
| MCP tool | `check_mcp_health` |
| CLI | `npm run mcp:health` |
| Slack | existing mcp-health intent keywords |

New fields ride on the same result object. No second CLI or tool.

## Silent-exception / error-shape probe

After the handshake (and even when it failed), POST a known-bad
`tools/call` for `__codesentinel_silent_probe_nonexistent__`.

A **protocol-honest** response is a JSON-RPC 2.0 error with:

- `error.code` a finite number
- `error.message` a non-empty string
- `id` matching the request, or FastMCP's transport `id: "server-error"`

HTTP status may be 200 (SSE/JSON style) or 4xx. Status alone is not the
verdict.

Alarm when HTTP is 2xx and the body is empty, non-JSON, a `result`
(swallowed success), or an error missing code/message. Reason codes:

- `SILENT_EXCEPTION` — 200 + HTML / success / non-JSON
- `EMPTY_PROTOCOL` — 200 + empty body
- `MALFORMED_RPC_ERROR` — JSON without a valid error shape

If `tools/call` is not conclusive (network throw), fall back to an initialize
fault. Do **not** treat a 404 on `tools/call` from a handshake-only fixture
as silent failure (that is not HTTP 200 empty protocol).

## Streamable HTTP diagnostic matrix

Five probes against the same `/mcp` URL. Each records status, a short
observation, `matched` (this server rejects this client mistake), `silent`
(2xx hid the failure), `reasonCode`, and an actionable `hint`.

| Probe | Request | Typical match |
|-------|---------|---------------|
| `wrong_method` | `PUT` initialize | 405/404 → `WRONG_METHOD` |
| `wrong_accept` | POST initialize with `Accept: application/json` only | 406 / "must accept text/event-stream" → `WRONG_ACCEPT` |
| `missing_session` | POST `tools/list` without `Mcp-Session-Id` | 400 "Missing session ID" → `MISSING_SESSION` |
| `get_vs_post` | `GET` with `Accept: application/json` | 405/406 or HTML page → `GET_VS_POST` |
| `session_sticky_mismatch` | POST `tools/list` with a fake `Mcp-Session-Id` | 400/404 "No valid session ID" → `SESSION_STICKY_MISMATCH` |

Matched rejections are **diagnostics**, not critical alarms. A 2xx empty or
success body on these probes is `silent` and raises `silent_exception`.
Stateless servers that ignore session headers report those probes as
unmatched (`SESSION_OPTIONAL` note only).

Handshake failures are classified with the same codes when the initialize
error matches (406 Accept, missing/unknown session, empty/HTML 200).

## Options

`silentException` and `streamableHttp` default true. `probes: false` or
CLI `--no-probes` skips both. Handshake / schema / secrets stay as they are.
