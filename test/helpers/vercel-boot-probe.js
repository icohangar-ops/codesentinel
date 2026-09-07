/**
 * Probe the Vercel Fluid Compute entry the way Vercel Node does:
 * ESM handler, require(esm) disabled, MCP_BEARER_TOKEN unset then set.
 *
 * Product constraint: GET /health is liveness → 200 even when token unset.
 * Fail-closed: POST /mcp → 401 when unset/invalid. With token configured,
 * health is 200 and authenticated initialize succeeds. Also asserts no
 * ERR_REQUIRE_ESM.
 */

async function main() {
  delete process.env.MCP_BEARER_TOKEN;
  const { default: handler } = await import("../../api/index.mjs");

  const healthUnset = await handler.fetch(new Request("http://127.0.0.1/health"));
  if (healthUnset.status !== 200) {
    throw new Error(`GET /health expected 200 when MCP_BEARER_TOKEN is unset (liveness), got ${healthUnset.status}`);
  }
  const healthUnsetBody = await healthUnset.json();
  if (!healthUnsetBody.ok || healthUnsetBody.transport !== "streamable-http") {
    throw new Error(`unexpected health payload when unset: ${JSON.stringify(healthUnsetBody)}`);
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

  const healthSet = await handler.fetch(new Request("http://127.0.0.1/health"));
  if (healthSet.status !== 200) {
    throw new Error(`GET /health expected 200 when token set, got ${healthSet.status}`);
  }
  const healthBody = await healthSet.json();
  if (!healthBody.ok || healthBody.transport !== "streamable-http") {
    throw new Error(`unexpected health payload: ${JSON.stringify(healthBody)}`);
  }

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
