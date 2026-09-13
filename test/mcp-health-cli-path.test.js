const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { resolveSafePath, loadBaseline } = require("../src/lib/mcp-health/cli");

describe("mcp-health CLI path confinement", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-health-safe-path-"));
  const nestedDir = path.join(base, "baselines");
  fs.mkdirSync(nestedDir);
  const fixture = path.join(nestedDir, "schema.json");
  fs.writeFileSync(fixture, `${JSON.stringify({ hash: "abc", tools: [] })}\n`);

  it("resolves relative in-tree paths under the base directory", () => {
    assert.equal(resolveSafePath("baselines/schema.json", base), fixture);
    assert.equal(resolveSafePath("./baselines/schema.json", base), fixture);
    assert.equal(resolveSafePath(fixture, base), fixture);
  });

  it("rejects .. traversal and absolute paths outside the base", () => {
    assert.throws(() => resolveSafePath("../secret.json", base), /outside allowed directory/);
    assert.throws(() => resolveSafePath("baselines/../../etc/passwd", base), /outside allowed directory/);
    assert.throws(() => resolveSafePath("/etc/passwd", base), /outside allowed directory/);
    assert.throws(() => resolveSafePath("", base), /Path is required/);
  });

  it("loads a baseline only when the file stays inside the base", () => {
    const snapshot = loadBaseline("baselines/schema.json", base);
    assert.equal(snapshot.hash, "abc");
    assert.throws(() => loadBaseline("../schema.json", base), /outside allowed directory/);
  });

  it("CLI --baseline rejects traversal before contacting the endpoint", () => {
    const result = spawnSync(
      process.execPath,
      [path.join(__dirname, "../src/lib/mcp-health/cli.js"), "https://example.invalid/mcp", "--baseline", "../etc/passwd"],
      { encoding: "utf8", cwd: __dirname }
    );
    assert.equal(result.status, 2);
    assert.match(result.stderr, /outside allowed directory/);
  });
});
