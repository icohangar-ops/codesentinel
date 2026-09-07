/**
 * Probe the Vercel Fluid Compute entry the way Vercel Node does:
 * ESM handler, require(esm) disabled, MCP_BEARER_TOKEN unset.
 *
 * Exits 0 only if GET /health is 200 and POST /mcp is fail-closed 401.
 */

async function main() {
  delete process.env.MCP_BEARER_TOKEN;
  const { default: handler } = await import("../../api/index.mjs");

  const health = await handler.fetch(new Request("http://127.0.0.1/health"));
  if (health.status !== 200) {
    throw new Error(`GET /health expected 200, got ${health.status}`);
  }
  const healthBody = await health.json();
  if (!healthBody.ok || healthBody.transport !== "streamable-http") {
    throw new Error(`unexpected health payload: ${JSON.stringify(healthBody)}`);
  }

  const mcp = await handler.fetch(
    new Request("http://127.0.0.1/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "probe", version: "0" } },
      }),
    })
  );
  if (mcp.status !== 401) {
    throw new Error(`POST /mcp without token expected 401, got ${mcp.status}`);
  }

  const token = "probe-bearer-token-ok";
  process.env.MCP_BEARER_TOKEN = token;
  const init = await handler.fetch(
    new Request("http://127.0.0.1/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "probe", version: "0" } },
      }),
    })
  );
  if (init.status !== 200) {
    throw new Error(`authenticated initialize expected 200, got ${init.status}`);
  }
  const initBody = await init.json();
  if (initBody.result?.serverInfo?.name !== "CodeSentinel") {
    throw new Error(`unexpected initialize body: ${JSON.stringify(initBody)}`);
  }

  process.stdout.write("ok\n");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
