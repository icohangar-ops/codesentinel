# Change: MCP protocol health (handshake ≠ HTTP 200)

## Why

Remote MCP servers can look “up” to a load balancer, status page, or TCP probe
while the protocol is dead. Typical silent failures: HTTP 200 with an HTML
login wall, an empty body, a JSON-RPC error, or an SSE stream that never
delivers `initialize` / `tools/list`. Tool schemas also drift without notice,
and tool descriptions can leak secrets into agent context.

HTTP uptime is not MCP health. CodeSentinel already owns a “health” surface
for codebases; this change adds a protocol-level check for remote MCP
endpoints on the same product, without turning the repo into a generic
monitor.

## What Changes

- Synthetic Streamable HTTP and legacy HTTP+SSE handshake checks that run
  `initialize` + `notifications/initialized` + `tools/list`.
- Canonical SHA-256 hashing of tool schemas and drift alarms when `tools/list`
  changes.
- Discovery-latency metrics (`initializeMs`, `toolsListMs`, `handshakeMs`).
- Secret scanning of tool names, descriptions, and schemas before they are
  treated as safe agent context.
- Docs that separate endpoint uptime from MCP protocol health.
- Tests for HTTP 200 handshake failure, schema drift, and secret-in-description.

## Impact

- New library: `src/lib/mcp-health` (alongside existing `src/lib/resilience`).
- New analyzer: `lib/analyzers/mcp-health.js`.
- New MCP tool: `check_mcp_health`.
- Slack intent keywords for MCP handshake checks.
- README + `docs/mcp-health.md` entrypoints.

## Non-goals

- Replacing Slack/app HTTP liveness.
- Calling remote tools (only discovery handshake).
- Persisted time-series storage (metrics are per-check).
