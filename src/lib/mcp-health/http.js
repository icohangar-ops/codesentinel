/**
 * Shared HTTP helpers for MCP handshake, silent probes, and Streamable diagnostics.
 */

const { safeFetch } = require("../resilience");
const { collectJsonRpcMessages } = require("./jsonrpc");

const PROTOCOL_VERSION = "2025-03-26";
const CLIENT_INFO = { name: "codesentinel-mcp-health", version: "1.0.0" };

function originFrom(url) {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}

function resolveUrl(base, maybeRelative) {
  return new URL(maybeRelative, base).toString();
}

async function readBody(response, { timeoutMs, stopWhen } = {}) {
  const contentType = response.headers.get("content-type") || "";
  if (!response.body || typeof response.body.getReader !== "function") {
    const text = typeof response.text === "function" ? await response.text() : "";
    return { text, contentType };
  }

  const needsStream = Boolean(stopWhen) || contentType.toLowerCase().includes("text/event-stream");
  if (!needsStream) {
    return { text: await response.text(), contentType };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let timedOut = false;
  const timer = timeoutMs
    ? setTimeout(() => {
        timedOut = true;
        reader.cancel("mcp-health-timeout").catch(() => {});
      }, timeoutMs)
    : null;
  if (timer && typeof timer.unref === "function") timer.unref();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      if (stopWhen && stopWhen(text)) {
        await reader.cancel().catch(() => {});
        break;
      }
    }
  } finally {
    if (timer) clearTimeout(timer);
  }

  return { text, contentType, timedOut };
}

function sessionIdFrom(response) {
  return response.headers.get("mcp-session-id") || response.headers.get("Mcp-Session-Id") || null;
}

function headersFor(url, { sessionId, extraHeaders } = {}) {
  const headers = {
    Accept: "application/json, text/event-stream",
    "Content-Type": "application/json",
    "MCP-Protocol-Version": PROTOCOL_VERSION,
    Origin: originFrom(url) || "http://localhost",
    ...extraHeaders,
  };
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;
  return headers;
}

async function rawRequest(url, options = {}) {
  const method = options.method || "POST";
  const headers = options.headers || headersFor(url, { sessionId: options.sessionId, extraHeaders: options.extraHeaders });
  let body = options.body;
  if (body != null && typeof body !== "string" && !Buffer.isBuffer(body)) {
    body = JSON.stringify(body);
  }

  const response = await safeFetch(url, {
    method,
    headers,
    body,
    fetchImpl: options.fetchImpl,
    timeoutMs: options.timeoutMs,
    maxAttempts: options.maxAttempts ?? 1,
    allowlist: options.allowlist,
  });

  const parsed = await readBody(response, {
    timeoutMs: options.sseTimeoutMs ?? options.timeoutMs,
    stopWhen: options.stopWhen,
  });
  const payload = collectJsonRpcMessages(parsed.text, parsed.contentType);
  return {
    response,
    httpStatus: response.status,
    sessionId: sessionIdFrom(response) || options.sessionId || null,
    payload,
    text: parsed.text,
    contentType: parsed.contentType,
    timedOut: parsed.timedOut,
  };
}

async function postRpc(url, message, options = {}) {
  return rawRequest(url, {
    ...options,
    method: "POST",
    headers: headersFor(url, { sessionId: options.sessionId, extraHeaders: options.headers }),
    body: JSON.stringify(message),
  });
}

function initializePayload(options = {}) {
  return {
    protocolVersion: options.protocolVersion || PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: options.clientInfo || CLIENT_INFO,
  };
}

module.exports = {
  PROTOCOL_VERSION,
  CLIENT_INFO,
  originFrom,
  resolveUrl,
  readBody,
  sessionIdFrom,
  headersFor,
  rawRequest,
  postRpc,
  initializePayload,
};
