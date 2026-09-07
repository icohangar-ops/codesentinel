const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { checkMcpHealth, REASON_CODES } = require("../src/lib/mcp-health");
const { listen, createFastMcpLikeHandler } = require("./helpers/mcp-http");

describe("silent-exception / JSON-RPC error-shape probe", () => {
  it("alarms on HTTP 200 empty body for a known-bad tools/call", async () => {
    const fixture = await listen(createFastMcpLikeHandler({ silentMode: "empty" }));
    try {
      const result = await checkMcpHealth(fixture.url, { timeoutMs: 2000, transport: "streamable-http" });
      assert.equal(result.httpUp, true);
      assert.equal(result.protocolHealthy, true);
      assert.equal(result.silentProbe.httpUp, true);
      assert.equal(result.silentProbe.httpStatus, 200);
      assert.equal(result.silentProbe.ok, false);
      assert.equal(result.silentProbe.reasonCode, REASON_CODES.EMPTY_PROTOCOL);
      assert.equal(result.ok, false);
      assert.ok(result.alarms.some((a) => a.type === "silent_exception" && a.reasonCode === REASON_CODES.EMPTY_PROTOCOL));
    } finally {
      await fixture.close();
    }
  });

  it("alarms when a nonexistent tool returns HTTP 200 success", async () => {
    const fixture = await listen(createFastMcpLikeHandler({ silentMode: "success" }));
    try {
      const result = await checkMcpHealth(fixture.url, { timeoutMs: 2000, transport: "streamable-http" });
      assert.equal(result.silentProbe.ok, false);
      assert.equal(result.silentProbe.reasonCode, REASON_CODES.SILENT_EXCEPTION);
      assert.ok(result.alarms.some((a) => a.type === "silent_exception"));
    } finally {
      await fixture.close();
    }
  });

  it("alarms on a malformed JSON-RPC error object", async () => {
    const fixture = await listen(createFastMcpLikeHandler({ silentMode: "malformed" }));
    try {
      const result = await checkMcpHealth(fixture.url, { timeoutMs: 2000, transport: "streamable-http" });
      assert.equal(result.silentProbe.ok, false);
      assert.equal(result.silentProbe.reasonCode, REASON_CODES.MALFORMED_RPC_ERROR);
      assert.ok(result.alarms.some((a) => a.type === "malformed_rpc_error"));
    } finally {
      await fixture.close();
    }
  });

  it("passes when the known-bad tools/call returns a well-formed JSON-RPC error", async () => {
    const fixture = await listen(createFastMcpLikeHandler({ silentMode: "error" }));
    try {
      const result = await checkMcpHealth(fixture.url, { timeoutMs: 2000, transport: "streamable-http" });
      assert.equal(result.protocolHealthy, true);
      assert.equal(result.silentProbe.ok, true);
      assert.equal(result.silentProbe.errorShape.code, -32602);
      assert.match(result.silentProbe.errorShape.message, /Unknown tool/);
      assert.equal(
        result.alarms.some((a) => a.type === "silent_exception" || a.type === "malformed_rpc_error"),
        false
      );
      assert.equal(result.ok, true);
    } finally {
      await fixture.close();
    }
  });

  it("alarms when Starlette-like handlers return HTTP 200 HTML for every method", async () => {
    const fixture = await listen((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<html><body>OK</body></html>");
    });
    try {
      const result = await checkMcpHealth(fixture.url, { timeoutMs: 2000, transport: "streamable-http" });
      assert.equal(result.http.status, 200);
      assert.equal(result.httpUp, true);
      assert.equal(result.protocolHealthy, false);
      assert.ok(result.alarms.some((a) => a.type === "handshake_failed"));
      assert.ok(result.alarms.some((a) => a.type === "silent_exception"));
      assert.ok(result.reasonCodes.includes(REASON_CODES.SILENT_EXCEPTION));
    } finally {
      await fixture.close();
    }
  });
});
