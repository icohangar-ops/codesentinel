const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { checkMcpHealth, REASON_CODES, runStreamableDiagnostics } = require("../src/lib/mcp-health");
const { listen, createFastMcpLikeHandler, readJson, sendJson, initializeResult, handleInitialized } = require("./helpers/mcp-http");

function probeById(result, id) {
  return (result.streamableHttp || result).probes.find((p) => p.id === id);
}

describe("Streamable HTTP diagnostic matrix", () => {
  it("reports FastMCP-style Accept, session, GET, and method reason codes", async () => {
    const fixture = await listen(createFastMcpLikeHandler());
    try {
      const result = await checkMcpHealth(fixture.url, { timeoutMs: 2000, transport: "streamable-http" });
      assert.equal(result.protocolHealthy, true);
      assert.equal(result.silentProbe.ok, true);

      const method = probeById(result, "wrong_method");
      const accept = probeById(result, "wrong_accept");
      const missing = probeById(result, "missing_session");
      const getVsPost = probeById(result, "get_vs_post");
      const sticky = probeById(result, "session_sticky_mismatch");

      assert.equal(method.matched, true);
      assert.equal(method.reasonCode, REASON_CODES.WRONG_METHOD);
      assert.equal(method.httpStatus, 405);
      assert.match(method.hint, /POST/i);

      assert.equal(accept.matched, true);
      assert.equal(accept.reasonCode, REASON_CODES.WRONG_ACCEPT);
      assert.equal(accept.httpStatus, 406);
      assert.match(accept.hint, /text\/event-stream/);

      assert.equal(missing.matched, true);
      assert.equal(missing.reasonCode, REASON_CODES.MISSING_SESSION);
      assert.equal(missing.httpStatus, 400);
      assert.match(missing.hint, /Mcp-Session-Id/);

      assert.equal(getVsPost.matched, true);
      assert.equal(getVsPost.reasonCode, REASON_CODES.GET_VS_POST);
      assert.match(getVsPost.hint, /GET/i);

      assert.equal(sticky.matched, true);
      assert.equal(sticky.reasonCode, REASON_CODES.SESSION_STICKY_MISMATCH);
      assert.match(sticky.hint, /sticky|stale|restart/i);

      for (const code of [
        REASON_CODES.WRONG_METHOD,
        REASON_CODES.WRONG_ACCEPT,
        REASON_CODES.MISSING_SESSION,
        REASON_CODES.GET_VS_POST,
        REASON_CODES.SESSION_STICKY_MISMATCH,
      ]) {
        assert.ok(result.reasonCodes.includes(code), `missing ${code}`);
      }

      assert.equal(
        result.alarms.some((a) => a.type === "silent_exception" || a.type === "malformed_rpc_error"),
        false
      );
    } finally {
      await fixture.close();
    }
  });

  it("does not treat a stateless server as session-mismatch", async () => {
    const fixture = await listen(async (req, res) => {
      if (req.method !== "POST") {
        res.writeHead(405);
        res.end();
        return;
      }
      const body = await readJson(req);
      if (body.method === "initialize") {
        sendJson(res, 200, { jsonrpc: "2.0", id: body.id, result: initializeResult() });
        return;
      }
      if (body.method === "notifications/initialized") {
        handleInitialized(res);
        return;
      }
      if (body.method === "tools/list") {
        sendJson(res, 200, { jsonrpc: "2.0", id: body.id, result: { tools: [] } });
        return;
      }
      if (body.method === "tools/call") {
        sendJson(res, 200, {
          jsonrpc: "2.0",
          id: body.id,
          error: { code: -32602, message: "Unknown tool" },
        });
        return;
      }
      res.writeHead(404);
      res.end();
    });

    try {
      const matrix = await runStreamableDiagnostics(fixture.url, { timeoutMs: 2000 });
      assert.equal(matrix.probes.find((p) => p.id === "wrong_method").matched, true);
      assert.equal(matrix.probes.find((p) => p.id === "missing_session").matched, false);
      assert.equal(matrix.probes.find((p) => p.id === "session_sticky_mismatch").matched, false);
    } finally {
      await fixture.close();
    }
  });

  it("classifies handshake 406 as WRONG_ACCEPT", async () => {
    const fixture = await listen((_req, res) => {
      sendJson(res, 406, {
        jsonrpc: "2.0",
        id: "server-error",
        error: { code: -32600, message: "Not Acceptable: Client must accept text/event-stream" },
      });
    });
    try {
      const result = await checkMcpHealth(fixture.url, {
        timeoutMs: 2000,
        transport: "streamable-http",
        streamableHttp: false,
        silentException: false,
      });
      assert.equal(result.protocolHealthy, false);
      const handshake = result.alarms.find((a) => a.type === "handshake_failed");
      assert.equal(handshake.reasonCode, REASON_CODES.WRONG_ACCEPT);
      assert.ok(result.reasonCodes.includes(REASON_CODES.WRONG_ACCEPT));
    } finally {
      await fixture.close();
    }
  });
});
