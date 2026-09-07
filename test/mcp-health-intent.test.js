const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { parseAnalysisRequest } = require("../lib/intent-parser");

describe("mcp health intent", () => {
  it("routes mcp handshake language to mcp_health and keeps full scans distinct", () => {
    const mcp = parseAnalysisRequest("Run mcp health on https://tools.example.com/mcp");
    assert.equal(mcp.type, "mcp_health");
    assert.equal(mcp.mcpUrl, "https://tools.example.com/mcp");

    const streamable = parseAnalysisRequest("Diagnose streamable http on https://tools.example.com/mcp");
    assert.equal(streamable.type, "mcp_health");
    assert.equal(streamable.mcpUrl, "https://tools.example.com/mcp");

    const full = parseAnalysisRequest("Run a full health scan on https://github.com/org/repo");
    assert.equal(full.type, "full");
    assert.equal(full.mcpUrl, null);
  });
});
