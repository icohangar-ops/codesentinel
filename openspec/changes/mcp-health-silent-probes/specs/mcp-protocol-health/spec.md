# mcp-protocol-health

Protocol-level health for remote MCP servers. HTTP status alone is not health.

## ADDED Requirements

### Requirement: Silent-exception JSON-RPC error-shape probe

The system SHALL send a known-bad `tools/call` (nonexistent tool) or, when
that request is not conclusive, an initialize fault. A well-formed JSON-RPC
error (`error.code` number, `error.message` non-empty string) SHALL pass the
probe. An HTTP 2xx response with an empty body, non-JSON body, success
`result`, or malformed error SHALL raise a critical alarm
(`silent_exception` or `malformed_rpc_error`) and MUST NOT be treated as
protocol-honest.

#### Scenario: HTTP 200 empty body on known-bad tools/call

- **GIVEN** an endpoint that returns HTTP 200 with an empty body for
  `tools/call`
- **WHEN** a health check runs the silent-exception probe
- **THEN** `http.up` is true, a `silent_exception` alarm is raised, and the
  reason code is `EMPTY_PROTOCOL`

#### Scenario: HTTP 200 success result for a nonexistent tool

- **GIVEN** an endpoint that returns HTTP 200 with a JSON-RPC `result` for a
  known-bad `tools/call`
- **WHEN** the silent-exception probe runs
- **THEN** a `silent_exception` alarm is raised with reason code
  `SILENT_EXCEPTION`

#### Scenario: Honest JSON-RPC error shape

- **GIVEN** an endpoint that returns a JSON-RPC error with integer `code` and
  non-empty `message` for a known-bad `tools/call`
- **WHEN** the silent-exception probe runs
- **THEN** the probe is ok and no `silent_exception` alarm is raised

### Requirement: Streamable HTTP diagnostic matrix with reason codes

The system SHALL probe Streamable HTTP client-mistake cases (wrong HTTP
method, wrong Accept, missing `Mcp-Session-Id`, GET vs POST `/mcp`, unknown
session id) and report an actionable reason code plus hint for each probe.
Matched rejections SHALL be diagnostics. A 2xx empty or success body on a
deliberately bad probe SHALL be treated as a silent protocol failure.

#### Scenario: FastMCP-style Accept and session rejections

- **GIVEN** an endpoint that requires `Accept: application/json,
  text/event-stream`, echoes `Mcp-Session-Id`, and rejects unknown sessions
- **WHEN** the Streamable HTTP diagnostic matrix runs
- **THEN** probes report `WRONG_ACCEPT`, `MISSING_SESSION`, `GET_VS_POST`,
  and `SESSION_STICKY_MISMATCH` as matched diagnostics with hints

#### Scenario: Wrong method is classified

- **GIVEN** an endpoint that rejects `PUT /mcp`
- **WHEN** the wrong-method probe runs
- **THEN** the probe reason code is `WRONG_METHOD`
