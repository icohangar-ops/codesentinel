# Design: Static public Glama claim

## Decision

Match Trust Ledger’s Vercel layout:

- `framework: null`, `fluid: true`
- `outputDirectory: "public"`
- Static claim at `public/.well-known/glama.json`
- Rewrites only for `/mcp`, `/health`, `/healthz` → `/api`

The Fluid function (`api/index.mjs`) is independent of the static output
directory. Hidden `.well-known` at the repo root is not a reliable Vercel
output path, which is why the previous rewrite existed.

## Claim token

Keep `glama_claim_vHBifndeHSeABPgFxW6qzO0hrCpYEb3i`. Copies must stay
byte-equivalent JSON (pretty, two-space indent, same keys) so verify and
tests cannot drift.

## Why not keep the rewrite

A rewrite can 200 with the right body while the verifier still treats the
published path as `/glama.json` (Vercel `Content-Disposition: filename="glama.json"`).
Serving the file from `public/.well-known/` removes that dependency.

## Auth and MCP

Unauthenticated GET for the claim only. `/mcp` stays fail-closed Bearer.
`/health` and `/healthz` stay unauthenticated liveness.
