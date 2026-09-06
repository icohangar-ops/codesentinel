const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { hashToolSchemas, compareToolSchemas } = require("../src/lib/mcp-health");
const { checkMcpHealth } = require("../src/lib/mcp-health");
const { listen, readJson, sendJson, initializeResult, handleInitialized } = require("./helpers/mcp-http");

const alpha = {
  name: "alpha",
  description: "First",
  inputSchema: { type: "object", properties: { q: { type: "string" } } },
};

const beta = {
  name: "beta",
  description: "Second",
  inputSchema: { type: "object", properties: {} },
};

describe("canonical tool-schema hashing and drift", () => {
  it("hashes the same snapshot regardless of tool or key order", () => {
    const a = hashToolSchemas([
      beta,
      { name: "alpha", inputSchema: { properties: { q: { type: "string" } }, type: "object" }, description: "First" },
    ]);
    const b = hashToolSchemas([alpha, beta]);
    assert.equal(a, b);
    assert.equal(a.length, 64);
  });

  it("alarms when tools/list adds, removes, or modifies tools", () => {
    const previous = [alpha, beta];
    const current = [
      { ...alpha, description: "First (changed)" },
      { name: "gamma", description: "New", inputSchema: { type: "object" } },
    ];
    const drift = compareToolSchemas(previous, current);
    assert.equal(drift.changed, true);
    assert.equal(drift.hashChanged, true);
    assert.deepEqual(drift.added, ["gamma"]);
    assert.deepEqual(drift.removed, ["beta"]);
    assert.deepEqual(drift.modified, ["alpha"]);
  });

  it("reports drift from a live handshake against a baseline hash", async () => {
    const tools = [{ name: "search", description: "v2 schema", inputSchema: { type: "object" } }];
    const fixture = await listen(async (req, res) => {
      const body = req.method === "POST" ? await readJson(req) : {};
      if (body.method === "initialize") {
        sendJson(res, 200, { jsonrpc: "2.0", id: body.id, result: initializeResult() });
        return;
      }
      if (body.method === "notifications/initialized") {
        handleInitialized(res);
        return;
      }
      if (body.method === "tools/list") {
        sendJson(res, 200, { jsonrpc: "2.0", id: body.id, result: { tools } });
        return;
      }
      res.writeHead(404);
      res.end();
    });

    try {
      const baselineHash = hashToolSchemas([{ name: "search", description: "v1 schema", inputSchema: { type: "object" } }]);
      const result = await checkMcpHealth(fixture.url, { baseline: baselineHash, timeoutMs: 2000 });
      assert.equal(result.protocolHealthy, true);
      assert.equal(result.schema.drift.changed, true);
      assert.equal(result.schema.drift.hashChanged, true);
      assert.equal(result.alarms.some((a) => a.type === "schema_drift"), true);
    } finally {
      await fixture.close();
    }
  });
});
