const { callLLM, LLMUnavailableError } = require("../../lib/llm-provider");
const { parseAnalysisRequest } = require("../../lib/intent-parser");
const { runAnalysis } = require("../../lib/analysis-engine");
const { buildResponseBlocks } = require("../../lib/block-kit-builder");
const { streamText, updateMessage } = require("./llm-caller");
const NodeCache = require("node-cache");

const analysisCache = new NodeCache({ stdTTL: 600, checkperiod: 120 });

async function handleAssistantMessage(app) {
  app.event("assistant_thread_context_changed", async ({ event, client, logger }) => {
    logger.info(`Thread context changed to channel ${event.assistant_thread.context_channel_id}`);
  });

  app.event("message", async ({ event, client, logger, say }) => {
    // Only respond in assistant threads or DMs to the bot
    if (event.subtype || event.bot_id) return;

    const isAssistantThread = event.thread_ts && !event.parent_user_id;
    const isAppMention = event.text && event.text.includes(`<@${app.client.token?.split("-")[0] || ""}>`);
    if (!isAssistantThread && !isAppMention) return;

    const threadTs = event.thread_ts || event.ts;
    const channel = event.channel;
    const userText = event.text.replace(/<@[^>]+>\s*/g, "").trim();

    logger.info(`Received message in thread ${threadTs}: ${userText.substring(0, 100)}...`);

    try {
      // Step 1: Parse intent
      const intent = parseAnalysisRequest(userText);
      logger.info(`Parsed intent: ${intent.type}, scope: ${intent.scope}`);

      // Step 2: Check cache
      const cacheKey = `${channel}-${intent.type}-${intent.scope}`;
      const cached = analysisCache.get(cacheKey);
      if (cached) {
        await say({ text: "Using cached results...", thread_ts: threadTs });
        const blocks = buildResponseBlocks(cached.results, cached.intent);
        await say({ blocks, thread_ts: threadTs });
        return;
      }

      // Step 3: Stream initial thinking
      const thinkingTs = await say({
        text: "",
        blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*Analyzing your codebase...*\n> ${intent.description}`,
            },
          },
          {
            type: "context",
            elements: [
              {
                type: "mrkdwn",
                text: `:hourglass: Running ${intent.type} analysis${intent.scope !== "full" ? ` on ${intent.scope}` : ""}...`,
              },
            ],
          },
        ],
        thread_ts: threadTs,
      });

      // Step 4: Run analysis
      const results = await runAnalysis(intent);

      // Step 5: Generate AI-powered summary
      const summary = await callLLM(
        `You are a senior software architect reviewing a codebase analysis. Based on these findings, provide a concise 3-5 sentence executive summary and 2-3 prioritized recommendations. Be specific and actionable.\n\nAnalysis type: ${intent.type}\nFindings:\n${JSON.stringify(results, null, 2)}`,
      );

      // Step 6: Build rich Block Kit response
      const blocks = buildResponseBlocks(results, intent, summary);

      // Step 7: Update the thinking message with results
      try {
        await client.chat.update({
          channel,
          ts: thinkingTs.ts || thinkingTs.message?.ts,
          blocks,
          text: `CodeSentinel ${intent.type} analysis complete.`,
        });
      } catch (updateErr) {
        // If update fails (too many blocks), post new message
        logger.warn("Message update failed, posting new message", updateErr);
        await say({ blocks, thread_ts: threadTs });
      }

      // Cache results
      analysisCache.set(cacheKey, { results, intent, summary });

    } catch (error) {
      logger.error("Error handling message:", error);
      // Surface a clean, user-safe message instead of leaking raw exception
      // text (API keys, stack traces, provider internals) into Slack.
      const userText =
        error instanceof LLMUnavailableError
          ? error.userMessage
          : "Something went wrong while analyzing the codebase. Please try again or provide a valid GitHub/GitLab repository URL.";
      await say({
        text: `❌ ${userText}`,
        thread_ts: threadTs,
      });
    }
  });
}

module.exports = { handleAssistantMessage };