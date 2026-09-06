# Design: MCP protocol health

## Surfaces

CodeSentinel is not an MCP-only monitor. Protocol health lives on the existing
infra + analysis surfaces:

| Surface | Entrypoint |
|---------|------------|
| Library | `src/lib/mcp-health` |
| Analyzer | `lib/analyzers/mcp-health.js` via `runAnalysis({ type: "mcp_health" })` |
| MCP tool | `check_mcp_health` in `mcp-server/index.js` |
| CLI | `npm run mcp:health -- <url>` |
| Slack | intent keywords (`mcp health`, `mcp handshake`, …) |
| Docs | `docs/mcp-health.md` |

## Handshake

Primary: Streamable HTTP (`2025-03-26` / `2025-11-25` style).

1. `POST initialize` with `Accept: application/json, text/event-stream`.
2. Capture `Mcp-Session-Id` when present; echo on later requests.
3. `POST notifications/initialized` (202 empty is success).
4. `POST tools/list`.
5. Parse either a JSON body or an SSE stream for the matching JSON-RPC id.

Fallback: legacy HTTP+SSE when Streamable HTTP returns 404/405/406, or when
GET yields an `endpoint` event.

A 2xx HTTP status is recorded as `http.up` only. `protocolHealthy` requires
a successful `initialize` result **and** a successful `tools/list` result.

## Schema hash

Canonical form: tools sorted by `name`; each tool is `{ name, description,
inputSchema }` with recursively sorted object keys. Hash is SHA-256 hex of
`JSON.stringify(canonical)`. Drift reports added / removed / modified names.

## Secrets

Scan `name`, `description`, and string leaves of `inputSchema` (including
property descriptions and examples). Findings redact the match. Critical
secrets fail the overall check so descriptions are not treated as safe
context.

## Latency

`process.hrtime.bigint()` around initialize, tools/list, and the full
handshake. Optional warning if `handshakeMs` exceeds `latencyWarnMs`.

## Dependencies

Reuse `safeFetch` from `src/lib/resilience` with `maxAttempts: 1` by default
so retries do not hide protocol failures or inflate discovery latency.
