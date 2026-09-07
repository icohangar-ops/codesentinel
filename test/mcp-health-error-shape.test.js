const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { validateJsonRpcErrorShape, assessErrorShape, REASON_CODES } = require("../src/lib/mcp-health");

describe("JSON-RPC error-shape helpers", () => {
  it("accepts a well-formed error and FastMCP transport id", () => {
    const ok = validateJsonRpcErrorShape(
      { jsonrpc: "2.0", id: 7, error: { code: -32602, message: "Unknown tool" } },
      7
    );
    assert.equal(ok.valid, true);
    assert.equal(ok.idMatched, true);
    assert.equal(ok.code, -32602);

    const transport = validateJsonRpcErrorShape(
      { jsonrpc: "2.0", id: "server-error", error: { code: -32600, message: "Missing session ID" } },
      7
    );
    assert.equal(transport.valid, true);
    assert.equal(transport.idMatched, true);
  });

  it("rejects missing code or empty message", () => {
    assert.equal(validateJsonRpcErrorShape({ id: 1, error: { message: "x" } }, 1).valid, false);
    assert.equal(validateJsonRpcErrorShape({ id: 1, error: { code: -32603, message: "" } }, 1).valid, false);
    assert.equal(validateJsonRpcErrorShape({ id: 1, result: {} }, 1).valid, false);
  });

  it("classifies HTTP 200 empty and success as silent protocol failures", () => {
    const empty = assessErrorShape({ httpStatus: 200, payload: { kind: "empty", messages: [] } }, 1);
    assert.equal(empty.ok, false);
    assert.equal(empty.alarmType, "silent_exception");
    assert.equal(empty.reasonCode, REASON_CODES.EMPTY_PROTOCOL);

    const success = assessErrorShape(
      {
        httpStatus: 200,
        payload: { kind: "json", messages: [{ jsonrpc: "2.0", id: 1, result: { content: [] } }] },
      },
      1
    );
    assert.equal(success.ok, false);
    assert.equal(success.reasonCode, REASON_CODES.SILENT_EXCEPTION);

    const honest = assessErrorShape(
      {
        httpStatus: 200,
        payload: {
          kind: "json",
          messages: [{ jsonrpc: "2.0", id: 1, error: { code: -32601, message: "Method not found" } }],
        },
      },
      1
    );
    assert.equal(honest.ok, true);
    assert.equal(honest.reasonCode, null);
  });
});
