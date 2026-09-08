const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const EXPECTED = {
  $schema: "https://glama.ai/mcp/schemas/connector.json",
  claim: "glama_claim_vHBifndeHSeABPgFxW6qzO0hrCpYEb3i",
};

const CLAIM_FILES = [
  "public/.well-known/glama.json",
  "public/glama.json",
  ".well-known/glama.json",
  "glama.json",
];

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
}

describe("Glama HTTP claim", () => {
  it("publishes the exact claim from public/.well-known and the static copies", () => {
    for (const rel of CLAIM_FILES) {
      assert.deepEqual(readJson(rel), EXPECTED, rel);
    }
  });

  it("serves /.well-known from public output without a rewrite", () => {
    const vercel = readJson("vercel.json");
    assert.equal(vercel.outputDirectory, "public");
    assert.equal(vercel.fluid, true);

    const rewrites = vercel.rewrites || [];
    assert.deepEqual(
      rewrites.map((rule) => rule.source),
      ["/mcp", "/health", "/healthz"]
    );
    for (const rule of rewrites) {
      assert.equal(rule.destination, "/api");
      assert.notEqual(rule.source, "/:path*");
      assert.notEqual(rule.source, "/(.*)");
      assert.notEqual(rule.source, "/:path(.*)");
      assert.equal(rule.source.includes("well-known"), false);
    }
  });
});
