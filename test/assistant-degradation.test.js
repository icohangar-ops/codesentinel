const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  LLMUnavailableError,
  summarizeWithLadder,
} = require("../lib/llm-provider");
const { buildResponseBlocks } = require("../lib/block-kit-builder");

// Row 18 (degradation ladder): the AI-summary step must degrade explicitly
// instead of discarding a completed deterministic analysis.

describe("summarizeWithLadder", () => {
  it("returns the summary unchanged when the LLM succeeds", async () => {
    const fake = async () => "a fine summary";
    const { summary, degraded } = await summarizeWithLadder(fake, "prompt");
    assert.equal(summary, "a fine summary");
    assert.equal(degraded, false);
  });

  it("degrades explicitly (null summary, degraded=true) on LLMUnavailableError", async () => {
    const fake = async () => {
      throw new LLMUnavailableError(new Error("provider down"));
    };
    const { summary, degraded } = await summarizeWithLadder(fake, "prompt");
    assert.equal(summary, null);
    assert.equal(degraded, true);
  });

  it("rethrows errors that are not LLM unavailability", async () => {
    const fake = async () => {
      throw new Error("bug in the caller");
    };
    await assert.rejects(() => summarizeWithLadder(fake, "prompt"), /bug in the caller/);
  });
});

describe("buildResponseBlocks degraded marker", () => {
  const results = {
    type: "quick",
    healthScore: 71,
    findings: [],
    stats: { filesScanned: 3 },
    categories: [],
  };

  it("labels degradation and omits the summary block when the LLM was unavailable", () => {
    const blocks = buildResponseBlocks(results, { type: "quick" }, null, true);
    const texts = JSON.stringify(blocks);
    assert.match(texts, /AI summary unavailable/);
    const summaryBlocks = blocks.filter((b) => b.block_id === "ai_summary");
    assert.equal(summaryBlocks.length, 0);
  });

  it("keeps the summary block and adds no marker when the LLM answered", () => {
    const blocks = buildResponseBlocks(results, { type: "quick" }, "good summary", false);
    const summaryBlocks = blocks.filter((b) => b.block_id === "ai_summary");
    assert.equal(summaryBlocks.length, 1);
    assert.equal(JSON.stringify(blocks).includes("AI summary unavailable"), false);
  });

  it("adds no marker when no summary and no degradation were requested", () => {
    const blocks = buildResponseBlocks(results, { type: "quick" }, null, false);
    assert.equal(JSON.stringify(blocks).includes("AI summary unavailable"), false);
  });
});
