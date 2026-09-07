# Change: Streamable HTTP transport for remote MCP / Glama

## Why

CodeSentinel MCP is stdio-only today (`StdioServerTransport`, `server.json`
transport `stdio`). Glama remote connectors require a **public HTTPS** endpoint
that speaks **streamable-http**. Without that transport, the server cannot be
listed as a hosted connector even though the tools already exist.

## What Changes

- Keep the existing stdio entrypoint (`mcp-server/index.js` / `npm run mcp:start`)
  working unchanged.
- Add a Node Streamable HTTP MCP entry that exposes the **same tools**.
- Run Streamable HTTP in **stateless** mode (`sessionIdGenerator: undefined`,
  new transport + server per request) so multi-replica hosting does not need
  sticky sessions.
- Fail-closed Bearer auth (`MCP_BEARER_TOKEN`). Missing or invalid credentials
  return HTTP 401. Tools are never exposed on a public URL without auth.
- Keep `LLM_API_KEY` and other secrets in server-side env only; never echo them.
- Document local HTTP run, Vercel Fluid Compute deploy, remote client config
  (`url` + `Authorization`), Glama connector field values, and Docker/Fly
  fallback. Do not invent a public hostname — URL/host stay env/template
  variables (`VERCEL_PROJECT_PRODUCTION_URL`, `{MCP_HTTP_HOST}`).
- Tests + a smoke script for `/health` and `initialize`.

## Impact

- New modules under `mcp-server/` (`create-server.js`, `http.js`, `auth.js`).
- `server.json` gains a `remotes` streamable-http template (host variable).
- README, `.env.sample`, Dockerfile, and deploy notes (`docs/mcp-http.md`).
- New tests in `test/mcp-http-transport.test.js` and `scripts/mcp-http-smoke.js`.

## Non-goals

- Changing analyzer behavior or Slack/Bolt.
- Hosting a live public URL from this change.
- Forcing Vercel/serverless (Streamable HTTP is a durable Node HTTP process).
- OAuth 2.1 / dynamic client registration (Bearer is sufficient for Glama API Key).
