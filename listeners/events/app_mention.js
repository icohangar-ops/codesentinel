const { parseAnalysisRequest } = require("../../lib/intent-parser");
const { runAnalysis } = require("../../lib/analysis-engine");
const { buildResponseBlocks } = require("../../lib/block-kit-builder");

async function handleAppMention(app) {
  app.event("app_mention", async ({ event, client, logger, say }) => {
    const userText = event.text.replace(/<@[^>]+>\s*/g, "").trim();
    logger.info(`App mention: ${userText.substring(0, 100)}`);

    if (!userText) {
      await say({
        text: "👋 Hi! I'm *CodeSentinel*, your codebase health agent.\n\nI can analyze your code for:\n• *Dead code* — unused functions, classes, modules\n• *Circular dependencies* — module import cycles\n• *Coupling metrics* — fan-out analysis, tightly coupled clusters\n• *Architectural drift* — layer boundary violations\n• *MCP protocol health* — initialize + tools/list (HTTP 200 is not enough)\n\nJust mention me with a GitHub/GitLab repo URL, an MCP endpoint, or describe what you'd like to scan!",
        thread_ts: event.ts,
      });
      return;
    }

    const intent = parseAnalysisRequest(userText);
    if (intent.type === "unknown") {
      await say({
        text: `I'm not sure what analysis to run. Try one of these:\n• "Scan for dead code in https://github.com/org/repo"\n• "Check coupling in our frontend"\n• "Run full health scan"`,
        thread_ts: event.ts,
      });
      return;
    }

    // Delegate to the main message handler by posting in the thread
    try {
      await say({
        text: `🔍 On it! Running a *${intent.type}* analysis${intent.scope && intent.scope !== "full" ? ` on ${intent.scope}` : ""} — live repo scans take a minute or two.`,
        thread_ts: event.ts,
      });
      const results = await runAnalysis(intent);
      const blocks = buildResponseBlocks(results, intent);
      await say({ text: "CodeSentinel analysis results", blocks, thread_ts: event.ts });
    } catch (error) {
      logger.error("Error handling app_mention:", error);
      await say({
        text: `❌ Analysis failed: ${error.message}`,
        thread_ts: event.ts,
      });
    }
  });
}

module.exports = { handleAppMention };