#!/usr/bin/env node

/**
 * Smoke: boot Streamable HTTP, check /health, reject unauthenticated
 * initialize, then complete an authenticated handshake.
 *
 *   MCP_BEARER_TOKEN=dev-token npm run mcp:http:smoke
 *
 * If MCP_HTTP_URL is set, the script probes that URL instead of starting
 * a local server. Host/URL are never hardcoded.
 */

const { startHttpServer } = require("../mcp-server/http");
const { checkMcpHealth } = require("../src/lib/mcp-health");
const { EXPECTED_TOOL_NAMES } = require("../mcp-server/create-server");

async function main() {
  const remote = process.env.MCP_HTTP_URL;
  const token = process.env.MCP_BEARER_TOKEN || "smoke-token-not-for-production";
  let listening;
  let url = remote;

  if (!url) {
    listening = await startHttpServer({
      host: "127.0.0.1",
      port: process.env.MCP_HTTP_PORT || 0,
      bearerToken: token,
      jsonResponse: true,
    });
    url = listening.url;
  }

  try {
    const healthUrl = new URL("/health", url).toString();
    const healthRes = await fetch(healthUrl);
    if (!healthRes.ok) throw new Error(`GET /health failed: HTTP ${healthRes.status}`);
    const health = await healthRes.json();
    if (!health.ok || health.transport !== "streamable-http") {
      throw new Error(`unexpected health payload: ${JSON.stringify(health)}`);
    }

    const unauth = await fetch(url, {
      method: "POST",
      headers: { Accept: "application/json, text/event-stream", "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "smoke", version: "0" } },
      }),
    });
    if (unauth.status !== 401) {
      throw new Error(`expected 401 without Bearer, got HTTP ${unauth.status}`);
    }

    const result = await checkMcpHealth(url, {
      timeoutMs: 5000,
      transport: "streamable-http",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!result.protocolHealthy) {
      throw new Error(`handshake failed: ${result.protocol?.initialize?.error || result.protocol?.toolsList?.error}`);
    }
    const names = result.tools.map((tool) => tool.name);
    for (const expected of EXPECTED_TOOL_NAMES) {
      if (!names.includes(expected)) throw new Error(`missing tool ${expected}`);
    }

    console.log(`ok health=${health.mode} tools=${names.length} url=${url}`);
  } finally {
    if (listening) await listening.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
