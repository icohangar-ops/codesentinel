const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const EXPECTED = {
  $schema: "https://glama.ai/mcp/schemas/connector.json",
  claim: "glama_claim_vHBifndeHSeABPgFxW6qzO0hrCpYEb3i",
};

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
}

describe("Glama HTTP claim", () => {
  it("publishes the exact claim at .well-known/glama.json and the static fallback", () => {
    assert.deepEqual(readJson(".well-known/glama.json"), EXPECTED);
    assert.deepEqual(readJson("glama.json"), EXPECTED);
  });

  it("does not rewrite /.well-known/* to the MCP /api handler", () => {
    const vercel = readJson("vercel.json");
    const rewrites = vercel.rewrites || [];
    const wellKnown = rewrites.find((rule) => rule.source === "/.well-known/glama.json");
    assert.ok(wellKnown, "expected an explicit /.well-known/glama.json rewrite");
    assert.equal(wellKnown.destination, "/glama.json");

    for (const rule of rewrites) {
      assert.notEqual(rule.source, "/:path*");
      assert.notEqual(rule.source, "/(.*)");
      assert.notEqual(rule.source, "/:path(.*)");
      if (rule.source.startsWith("/.well-known")) {
        assert.notEqual(rule.destination, "/api");
      }
    }

    const mcpSources = rewrites.filter((rule) => ["/mcp", "/health", "/healthz"].includes(rule.source));
    assert.equal(mcpSources.length, 3);
    for (const rule of mcpSources) {
      assert.equal(rule.destination, "/api");
    }
  });
});
