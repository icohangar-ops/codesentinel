# Change: Silent MCP failure probes + Streamable HTTP reason codes

## Why

Starlette/Uvicorn MCP stacks often swallow tool exceptions so HTTP still looks
fine (200, empty or HTML). FastMCP Streamable HTTP clients then hit 400/406
session and Accept mismatches with almost no signal. The existing handshake
already proves `HTTP 200 ≠ healthy`; it does not force a known-bad
`tools/call` or classify the Streamable HTTP failure modes clients actually
see.

## What Changes

- A silent-exception / JSON-RPC error-shape probe: send a known-bad
  `tools/call` (or initialize fault) and require a well-formed JSON-RPC error.
  HTTP 200 with an empty, non-JSON, success, or malformed protocol body is an
  alarm.
- A Streamable HTTP diagnostic matrix with actionable reason codes:
  `WRONG_METHOD`, `WRONG_ACCEPT`, `MISSING_SESSION`, `GET_VS_POST`,
  `SESSION_STICKY_MISMATCH` (plus silent/empty/malformed codes).
- Library / analyzer / MCP tool / CLI stay one `checkMcpHealth` surface.
- Docs and tests for both probes.

## Capabilities

### New Capabilities

- (none — extends existing protocol-health capability)

### Modified Capabilities

- `mcp-protocol-health`: add silent-exception probe and Streamable HTTP
  reason-code matrix to `check_mcp_health`.

## Impact

- `src/lib/mcp-health` (new probe + diagnostics modules)
- Analyzer findings, MCP tool payload, CLI summary
- `docs/mcp-health.md` + README
