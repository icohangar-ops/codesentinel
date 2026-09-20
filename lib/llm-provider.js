/**
 * LLM provider abstraction — supports OpenAI, Anthropic, Deepseek, and Google.
 *
 * Resilience: every provider call is bounded by a timeout and surfaces HTTP
 * errors instead of silently returning empty text. `callLLM` translates any
 * underlying failure into a typed `LLMUnavailableError` carrying a clean,
 * user-safe message so callers (e.g. the Slack listener) never leak raw
 * exception text or API internals to end users.
 */

const { safeFetch, ResilienceError } = require("../src/lib/resilience");

// Per-request budget for an LLM call (the audit asked for ~30s).
const LLM_TIMEOUT_MS = 30_000;

const USER_SAFE_MESSAGE =
  "The AI summarization service is temporarily unavailable. Analysis results are still shown below; please try again shortly for the AI summary.";

/**
 * Thrown when an LLM provider call fails. `message` is safe to show to end
 * users; the original cause is preserved on `.cause` for server-side logging.
 */
class LLMUnavailableError extends Error {
  constructor(cause) {
    super(USER_SAFE_MESSAGE);
    this.name = "LLMUnavailableError";
    this.userMessage = USER_SAFE_MESSAGE;
    if (cause !== undefined) this.cause = cause;
  }
}

async function callLLM(prompt, systemPrompt) {
  const provider = process.env.LLM_PROVIDER || "deepseek";
  try {
    switch (provider) {
      case "deepseek":
        return await callDeepseek(prompt, systemPrompt);
      case "openai":
        return await callOpenAI(prompt, systemPrompt);
      case "anthropic":
        return await callAnthropic(prompt, systemPrompt);
      default:
        return await callDeepseek(prompt, systemPrompt);
    }
  } catch (err) {
    // Surface a clean, typed error rather than leaking raw provider/exception
    // text. The original cause is preserved for logging.
    throw new LLMUnavailableError(err);
  }
}

async function callDeepseek(prompt, systemPrompt) {
  const { default: OpenAI } = await import("openai");
  const client = new OpenAI({
    apiKey: process.env.DEEPSEEK_API_KEY,
    baseURL: "https://api.deepseek.com",
    // SDK-level per-request timeout (the SDK aborts and throws on overrun).
    timeout: LLM_TIMEOUT_MS,
    maxRetries: 2,
  });

  const messages = [];
  if (systemPrompt) {
    messages.push({ role: "system", content: systemPrompt });
  }
  messages.push({ role: "user", content: prompt });

  const response = await client.chat.completions.create({
    model: "deepseek-chat",
    messages,
    max_tokens: 500,
    temperature: 0.3,
  });

  return response.choices[0]?.message?.content || "";
}

async function callOpenAI(prompt, systemPrompt) {
  const { default: OpenAI } = await import("openai");
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL || undefined,
    timeout: LLM_TIMEOUT_MS,
    maxRetries: 2,
  });

  const messages = [];
  if (systemPrompt) {
    messages.push({ role: "system", content: systemPrompt });
  }
  messages.push({ role: "user", content: prompt });

  const response = await openai.chat.completions.create({
    model: process.env.OPENAI_MODEL || "gpt-4o-mini",
    messages,
    max_tokens: 500,
    temperature: 0.3,
  });

  return response.choices[0]?.message?.content || "";
}

async function callAnthropic(prompt, systemPrompt) {
  // Raw fetch routed through safeFetch: per-attempt 30s AbortController
  // timeout, retry-with-backoff on 429/5xx + network errors, fail-fast on
  // other 4xx, and an SSRF allowlist pinned to the Anthropic host.
  const response = await safeFetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 500,
      system: systemPrompt || undefined,
      messages: [{ role: "user", content: prompt }],
    }),
    timeoutMs: LLM_TIMEOUT_MS,
    allowlist: ["api.anthropic.com"],
  });

  // safeFetch returns non-retryable 4xx responses to us; guard explicitly so a
  // client error (e.g. 401 bad key) does not silently degrade to empty text.
  if (!response.ok) {
    throw new ResilienceError(
      "http",
      `Anthropic API returned HTTP ${response.status}`,
      { status: response.status },
    );
  }

  const data = await response.json();
  return data.content?.[0]?.text || "";
}

/**
 * Row 18 degradation ladder for AI summaries (matrix row 18: FULL → DEGRADED
 * → OFF). A completed deterministic scan must never be discarded because the
 * summary step failed: an LLMUnavailableError degrades explicitly (summary
 * becomes null, degraded=true) so the caller ships findings without the
 * summary, labeled. Any other error rethrows — only unavailability degrades.
 */
async function summarizeWithLadder(callLLMFn, prompt, systemPrompt) {
  try {
    const summary = await callLLMFn(prompt, systemPrompt);
    return { summary, degraded: false };
  } catch (err) {
    if (!(err instanceof LLMUnavailableError)) throw err;
    return { summary: null, degraded: true };
  }
}

module.exports = { callLLM, LLMUnavailableError, summarizeWithLadder };
