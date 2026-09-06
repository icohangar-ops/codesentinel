# MCP protocol health vs HTTP uptime

A remote MCP URL that returns **HTTP 200** is not a healthy MCP server.

Load balancers, reverse proxies, and status pages answer TCP and HTTP. The Model
Context Protocol does not. Agents fail later, often after tool descriptions have
already been pulled into context, when:

- `initialize` returns HTML, an empty body, or a JSON-RPC error
- the Streamable HTTP POST is 200 but the SSE stream never yields a result
- `tools/list` is missing, malformed, or a different schema than last week
- a tool description embeds a token, key, or connection string

CodeSentinel treats those as **protocol** failures, not uptime failures.

## What this check does

1. **Synthetic handshake** — `initialize` → `notifications/initialized` →
   `tools/list` over Streamable HTTP. Legacy HTTP+SSE is used when the
   Streamable HTTP POST is 404/405/406 (or when you pass `--transport sse`).
2. **Canonical schema hash** — SHA-256 of tools sorted by name, with object
   keys sorted. Compare to a baseline to alarm on drift.
3. **Discovery latency** — `initializeMs`, `toolsListMs`, `handshakeMs`.
4. **Secret scan** — names, descriptions, and schema strings are scanned
   *before* they are treated as safe agent context. Matches are redacted.

`http.up` / `httpUp` means a 2xx status was observed. `protocolHealthy` means
both JSON-RPC results arrived. `ok` is false on any critical alarm
(handshake failure or leaked secret).

## Entrypoints

This repo is CodeSentinel (codebase health), not a standalone MCP monitor.
Protocol health is mounted on the existing surfaces:

| Surface | How to call |
|---------|-------------|
| Library | `require("./src/lib/mcp-health").checkMcpHealth(url)` |
| Analyzer | `runAnalysis({ type: "mcp_health", mcpUrl })` |
| MCP tool | `check_mcp_health` (`endpoint`, optional `baseline_hash`) |
| CLI | `npm run mcp:health -- https://host/mcp` |
| Slack | “mcp health”, “mcp handshake”, “remote mcp” + a URL |
| Spec | `openspec/changes/mcp-protocol-health/` |

```bash
# Probe a remote server. Exit 1 if protocol-unhealthy or secrets leak.
npm run mcp:health -- https://example.com/mcp

# Alarm when tools/list drifts from a saved snapshot
npm run mcp:health -- https://example.com/mcp --baseline ./mcp-schema.json --write-baseline ./mcp-schema.json
```

Do not use this in place of Slack Socket Mode liveness or `app.js` process
health. Those answer “is CodeSentinel running?”. This answers “does that
remote MCP endpoint still speak MCP?”
