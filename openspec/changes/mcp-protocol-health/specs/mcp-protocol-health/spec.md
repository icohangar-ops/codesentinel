# mcp-protocol-health

Protocol-level health for remote MCP servers. HTTP status alone is not health.

## ADDED Requirements

### Requirement: Synthetic handshake health check

The system SHALL probe a remote MCP endpoint with a real JSON-RPC handshake
(`initialize`, `notifications/initialized`, `tools/list`) over Streamable HTTP
and, when needed, legacy HTTP+SSE. A 2xx HTTP response without a valid
handshake SHALL be reported as protocol-unhealthy.

#### Scenario: HTTP 200 with failed initialize

- **GIVEN** a remote endpoint that returns HTTP 200 with an HTML body or a
  JSON-RPC error
- **WHEN** a health check runs
- **THEN** `http.up` is true, `protocolHealthy` is false, and a
  `handshake_failed` alarm is raised

#### Scenario: Successful Streamable HTTP handshake

- **GIVEN** an endpoint that answers `initialize` and `tools/list` with
  JSON-RPC results (JSON or SSE)
- **WHEN** a health check runs
- **THEN** `protocolHealthy` is true and discovered tools are returned

### Requirement: Canonical tool-schema hashing and drift alarms

The system SHALL compute a stable SHA-256 hash of the canonical `tools/list`
payload and compare it to a baseline when one is provided.

#### Scenario: tools/list schema changes

- **GIVEN** a previous tool list (or hash) and a current `tools/list` that
  added, removed, or modified a tool
- **WHEN** schemas are compared
- **THEN** a `schema_drift` alarm includes added, removed, and modified names

### Requirement: Discovery-latency metrics

The system SHALL record elapsed time for `initialize`, `tools/list`, and the
full handshake.

#### Scenario: Handshake timings are present

- **GIVEN** any completed check (success or failure)
- **WHEN** the result is returned
- **THEN** `latency.initializeMs`, `latency.toolsListMs`, and
  `latency.handshakeMs` are numbers

### Requirement: Secret scanning before agent context

The system SHALL scan tool names, descriptions, and schemas for credential
patterns and redact matches. Critical findings SHALL fail the check so the
payload is not treated as safe agent context.

#### Scenario: Secret in tool description

- **GIVEN** a `tools/list` result whose description contains an AWS key,
  GitHub token, or similar secret
- **WHEN** secrets are scanned
- **THEN** a `secret_in_description` finding is raised and `ok` is false
