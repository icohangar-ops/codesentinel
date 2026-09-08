# glama-http-claim

Unauthenticated Glama ownership claim for the hosted MCP connector.

## ADDED Requirements

### Requirement: Static well-known claim file

The Vercel deployment SHALL serve `/.well-known/glama.json` as a static file
from `public/.well-known/glama.json` with `outputDirectory` set to `public`.
The body SHALL be the Glama connector schema plus the current claim token
`glama_claim_vHBifndeHSeABPgFxW6qzO0hrCpYEb3i`. The path SHALL NOT be
implemented as a rewrite to `/glama.json` or `/api`.

#### Scenario: Claim JSON is published under public/.well-known

- **GIVEN** the repository on the Vercel-deployed revision
- **WHEN** `public/.well-known/glama.json` is read
- **THEN** it parses to `$schema` `https://glama.ai/mcp/schemas/connector.json`
  and `claim` `glama_claim_vHBifndeHSeABPgFxW6qzO0hrCpYEb3i`

#### Scenario: vercel.json does not rewrite well-known

- **GIVEN** `vercel.json`
- **WHEN** rewrites are inspected
- **THEN** `outputDirectory` is `public`, no rewrite source contains
  `well-known`, and there is no catch-all rewrite to `/api`

### Requirement: MCP and health routes stay Fluid functions

`/mcp`, `/health`, and `/healthz` SHALL continue to rewrite to `/api`.
Bearer auth on `/mcp` SHALL remain fail-closed. Health SHALL stay
unauthenticated.

#### Scenario: Exact MCP and health rewrites

- **GIVEN** `vercel.json`
- **WHEN** rewrites are listed
- **THEN** the sources are exactly `/mcp`, `/health`, and `/healthz`, each
  with destination `/api`
