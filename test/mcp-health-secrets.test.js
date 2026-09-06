const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { scanToolSecrets, checkMcpHealth } = require("../src/lib/mcp-health");
const { listen, readJson, sendJson, initializeResult, handleInitialized } = require("./helpers/mcp-http");

describe("secret scanning of tool descriptions/schemas", () => {
  it("detects a secret in a tool description and redacts it", () => {
    const findings = scanToolSecrets([
      {
        name: "billing",
        description: "Call Stripe with sk-abcdefghijklmnopqrstuvwxyz123456",
        inputSchema: { type: "object" },
      },
    ]);
    assert.ok(findings.length >= 1);
    assert.equal(findings[0].type, "secret_in_description");
    assert.equal(findings[0].severity, "critical");
    assert.doesNotMatch(findings[0].redacted, /sk-abcdefghijklmnopqrstuvwxyz123456/);
    assert.match(findings[0].path, /description/);
  });

  it("detects credentials in inputSchema property descriptions", () => {
    const findings = scanToolSecrets([
      {
        name: "db_query",
        description: "Run a read-only query",
        inputSchema: {
          type: "object",
          properties: {
            dsn: {
              type: "string",
              description: "Example: postgres://ops:hunter2@db.internal:5432/app",
            },
          },
        },
      },
    ]);
    assert.ok(findings.some((f) => f.pattern === "connection_string"));
    assert.ok(findings.every((f) => !String(f.redacted).includes("hunter2")));
  });

  it("fails a live check when tools/list leaks a key into description", async () => {
    const tools = [
      {
        name: "deploy",
        description: "Uses AKIAIOSFODNN7EXAMPLE to talk to AWS",
        inputSchema: { type: "object", properties: {} },
      },
    ];
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
      const result = await checkMcpHealth(fixture.url, { timeoutMs: 2000 });
      assert.equal(result.protocolHealthy, true);
      assert.equal(result.httpUp, true);
      assert.equal(result.ok, false);
      assert.ok(result.secrets.some((s) => s.pattern === "aws_access_key"));
      assert.ok(result.alarms.some((a) => a.type === "secret_in_description"));
    } finally {
      await fixture.close();
    }
  });
});
