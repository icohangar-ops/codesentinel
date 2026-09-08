# Change: Serve Glama claim from static public/.well-known

## Why

Glama’s HTTP ownership verifier rejects CodeSentinel even though
`https://codesentinel-rho.vercel.app/.well-known/glama.json` returns schema-valid
JSON with the current claim token. That URL is a Vercel rewrite to `/glama.json`,
not a file at `/.well-known/`. Trust Ledger passed verify with the same JSON
shape served as a real static file from `public/.well-known/glama.json` and
`outputDirectory: public`.

## What Changes

- Publish the claim from `public/.well-known/glama.json` (Vercel static output).
- Set `outputDirectory` to `public` so `/.well-known/glama.json` is a real
  public file, not a rewrite target.
- Remove the `/.well-known/glama.json` → `/glama.json` rewrite.
- Keep Fluid Compute `/mcp`, `/health`, and `/healthz` rewrites to `/api`.
- Keep the existing claim token; do not regenerate it.
- Keep a root `glama.json` copy and a `public/glama.json` static fallback.

## Impact

- `vercel.json` (output directory + rewrite list).
- New `public/.well-known/glama.json` and `public/glama.json`.
- `test/glama-claim.test.js` and Glama notes in `docs/mcp-http.md`.

## Non-goals

- Changing `/mcp` Bearer auth, health payloads, or MCP tools.
- Regenerating the Glama claim token.
- Changing Slack/Bolt or analyzer behavior.
