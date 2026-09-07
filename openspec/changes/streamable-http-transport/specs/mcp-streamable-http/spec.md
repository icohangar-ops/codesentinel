# mcp-streamable-http

Public Streamable HTTP transport for CodeSentinel MCP, alongside unchanged stdio.

## ADDED Requirements

### Requirement: Stdio entrypoint remains unchanged

The existing stdio MCP entry (`mcp-server/index.js`, `npm run mcp:start`,
package bin `codesentinel-mcp`) SHALL keep speaking MCP over stdio with the
same tools.

#### Scenario: Stdio still initializes

- **GIVEN** the stdio server process
- **WHEN** a client sends JSON-RPC `initialize` on stdin
- **THEN** stdout returns a result with server name CodeSentinel and the process
  does not require `MCP_BEARER_TOKEN`

### Requirement: Stateless Streamable HTTP exposes the same tools

HTTP mode SHALL implement MCP Streamable HTTP on a single path (default `/mcp`)
in stateless mode so any replica can handle any request.

#### Scenario: Authenticated initialize and tools/list

- **GIVEN** an HTTP server started with `MCP_BEARER_TOKEN`
- **WHEN** a client POSTs `initialize` then `tools/list` with a valid Bearer token
- **THEN** both JSON-RPC results succeed and the tool names match stdio

### Requirement: Fail-closed Bearer authentication

The HTTP MCP path SHALL require a configured Bearer token. Missing or invalid
credentials SHALL return HTTP 401. The process SHALL not listen if the token
env is unset. Tools SHALL not be reachable without auth.

#### Scenario: Missing Authorization header

- **GIVEN** a running HTTP MCP server
- **WHEN** a client POSTs to `/mcp` without `Authorization`
- **THEN** the response is HTTP 401 and no tool list is returned

#### Scenario: Invalid Bearer token

- **GIVEN** a running HTTP MCP server
- **WHEN** a client POSTs with `Authorization: Bearer wrong`
- **THEN** the response is HTTP 401

### Requirement: Secrets stay server-side

HTTP responses SHALL NOT echo `LLM_API_KEY`, `MCP_BEARER_TOKEN`, or other
credential env values.

#### Scenario: Health and tools/list omit secrets

- **GIVEN** credential env vars are set on the process
- **WHEN** `/health` or an authenticated `tools/list` is returned
- **THEN** the body does not contain those secret values

### Requirement: Host and public URL remain configuration

Documentation and `server.json` SHALL NOT invent a production hostname. The
public HTTPS URL is supplied by the operator (env / registry variables).

#### Scenario: server.json remote uses a host variable

- **GIVEN** `server.json`
- **WHEN** a remote streamable-http entry is present
- **THEN** its URL is a template such as `https://{MCP_HTTP_HOST}/mcp`
