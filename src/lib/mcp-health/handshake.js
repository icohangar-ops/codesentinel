/**
 * Synthetic MCP handshake: Streamable HTTP (primary) and legacy HTTP+SSE.
 * HTTP 2xx is not treated as success — JSON-RPC initialize + tools/list must land.
 */

const { safeFetch } = require("../resilience");
const { collectJsonRpcMessages, findJsonRpcById, findSseEndpoint } = require("./jsonrpc");
const {
  PROTOCOL_VERSION,
  CLIENT_INFO,
  originFrom,
  resolveUrl,
  readBody,
  postRpc,
} = require("./http");

function nowNs() {
  return process.hrtime.bigint();
}

function msSince(startNs) {
  return Number(nowNs() - startNs) / 1e6;
}

function interpretRpc(payload, id, httpStatus) {
  if (payload.kind === "invalid-json") {
    return { ok: false, error: `HTTP ${httpStatus} returned invalid JSON: ${payload.error}` };
  }
  if (payload.kind === "empty") {
    return { ok: false, error: `HTTP ${httpStatus} with empty body (no JSON-RPC result)` };
  }
  if (payload.kind === "non-json") {
    const preview = String(payload.raw || "").replace(/\s+/g, " ").slice(0, 120);
    return { ok: false, error: `HTTP ${httpStatus} returned non-JSON body: ${preview}` };
  }

  const message = findJsonRpcById(payload.messages, id);
  if (!message) {
    return { ok: false, error: `HTTP ${httpStatus} had no JSON-RPC response for id ${id}` };
  }
  if (message.error) {
    const detail = message.error.message || JSON.stringify(message.error);
    return { ok: false, error: `JSON-RPC error: ${detail}`, rpcError: message.error };
  }
  if (message.result === undefined) {
    return { ok: false, error: `JSON-RPC response id ${id} missing result` };
  }
  return { ok: true, result: message.result };
}

function nextId(state) {
  state.id += 1;
  return state.id;
}

async function handshakeStreamableHttp(endpoint, options = {}) {
  const state = { id: 0 };
  const latency = { initializeMs: 0, toolsListMs: 0, handshakeMs: 0 };
  const handshakeStart = nowNs();
  const steps = [];
  let sessionId = options.sessionId || null;
  let httpStatus = null;
  let tools = [];

  const initializeId = nextId(state);
  const initStarted = nowNs();
  let initOutcome;
  try {
    const posted = await postRpc(
      endpoint,
      {
        jsonrpc: "2.0",
        id: initializeId,
        method: "initialize",
        params: {
          protocolVersion: options.protocolVersion || PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: options.clientInfo || CLIENT_INFO,
        },
      },
      options
    );
    httpStatus = posted.httpStatus;
    sessionId = posted.sessionId || sessionId;
    initOutcome = interpretRpc(posted.payload, initializeId, posted.httpStatus);
    if (initOutcome.ok && !initOutcome.result.protocolVersion && !initOutcome.result.serverInfo) {
      initOutcome = { ok: false, error: "initialize result missing protocolVersion/serverInfo" };
    }
    steps.push({ method: "initialize", httpStatus: posted.httpStatus, transport: "streamable-http" });
  } catch (error) {
    initOutcome = { ok: false, error: error.message, cause: error };
    steps.push({ method: "initialize", error: error.message, transport: "streamable-http" });
  }
  latency.initializeMs = roundMs(msSince(initStarted));

  if (!initOutcome.ok) {
    latency.handshakeMs = roundMs(msSince(handshakeStart));
    return {
      transport: "streamable-http",
      httpStatus,
      sessionId,
      initialize: initOutcome,
      toolsList: { ok: false, error: "skipped: initialize failed" },
      tools,
      latency,
      steps,
    };
  }

  try {
    await postRpc(
      endpoint,
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { ...options, sessionId }
    );
    steps.push({ method: "notifications/initialized", transport: "streamable-http" });
  } catch (error) {
    steps.push({ method: "notifications/initialized", error: error.message, transport: "streamable-http" });
  }

  const listId = nextId(state);
  const listStarted = nowNs();
  let listOutcome;
  try {
    const posted = await postRpc(
      endpoint,
      { jsonrpc: "2.0", id: listId, method: "tools/list", params: {} },
      { ...options, sessionId }
    );
    httpStatus = posted.httpStatus;
    sessionId = posted.sessionId || sessionId;
    listOutcome = interpretRpc(posted.payload, listId, posted.httpStatus);
    if (listOutcome.ok) {
      tools = Array.isArray(listOutcome.result.tools) ? listOutcome.result.tools : [];
    }
    steps.push({ method: "tools/list", httpStatus: posted.httpStatus, transport: "streamable-http" });
  } catch (error) {
    listOutcome = { ok: false, error: error.message, cause: error };
    steps.push({ method: "tools/list", error: error.message, transport: "streamable-http" });
  }
  latency.toolsListMs = roundMs(msSince(listStarted));
  latency.handshakeMs = roundMs(msSince(handshakeStart));

  return {
    transport: "streamable-http",
    httpStatus,
    sessionId,
    initialize: initOutcome,
    toolsList: listOutcome,
    tools,
    latency,
    steps,
  };
}

async function handshakeSse(endpoint, options = {}) {
  const latency = { initializeMs: 0, toolsListMs: 0, handshakeMs: 0 };
  const handshakeStart = nowNs();
  const steps = [];
  let httpStatus = null;

  const initStarted = nowNs();
  let messageUrl;
  try {
    const response = await safeFetch(endpoint, {
      method: "GET",
      headers: {
        Accept: "text/event-stream",
        Origin: originFrom(endpoint) || "http://localhost",
        ...options.headers,
      },
      fetchImpl: options.fetchImpl,
      timeoutMs: options.timeoutMs,
      maxAttempts: options.maxAttempts ?? 1,
      allowlist: options.allowlist,
    });
    httpStatus = response.status;
    const body = await readBody(response, {
      timeoutMs: options.sseTimeoutMs ?? options.timeoutMs,
      stopWhen: (text) => Boolean(findSseEndpoint(collectJsonRpcMessages(text, "text/event-stream").sseEvents)),
    });
    const payload = collectJsonRpcMessages(body.text, body.contentType || "text/event-stream");
    const relative = findSseEndpoint(payload.sseEvents);
    if (!relative) {
      latency.initializeMs = roundMs(msSince(initStarted));
      latency.handshakeMs = roundMs(msSince(handshakeStart));
      return {
        transport: "sse",
        httpStatus,
        initialize: {
          ok: false,
          error: `HTTP ${httpStatus} SSE stream did not emit an endpoint event`,
        },
        toolsList: { ok: false, error: "skipped: SSE endpoint event missing" },
        tools: [],
        latency,
        steps: [{ method: "sse-open", httpStatus, transport: "sse" }],
      };
    }
    messageUrl = resolveUrl(endpoint, relative);
    steps.push({ method: "sse-open", httpStatus, transport: "sse", messageUrl });
  } catch (error) {
    latency.initializeMs = roundMs(msSince(initStarted));
    latency.handshakeMs = roundMs(msSince(handshakeStart));
    return {
      transport: "sse",
      httpStatus,
      initialize: { ok: false, error: error.message, cause: error },
      toolsList: { ok: false, error: "skipped: SSE open failed" },
      tools: [],
      latency,
      steps: [{ method: "sse-open", error: error.message, transport: "sse" }],
    };
  }

  const sseOpenMs = msSince(initStarted);
  const streamed = await handshakeStreamableHttp(messageUrl, { ...options, transport: "streamable-http" });
  streamed.transport = "sse";
  streamed.sseMessageUrl = messageUrl;
  streamed.latency = {
    initializeMs: roundMs(sseOpenMs + streamed.latency.initializeMs),
    toolsListMs: streamed.latency.toolsListMs,
    handshakeMs: roundMs(msSince(handshakeStart)),
  };
  streamed.steps = [...steps, ...streamed.steps.map((step) => ({ ...step, transport: "sse" }))];
  if (httpStatus != null && streamed.httpStatus == null) streamed.httpStatus = httpStatus;
  return streamed;
}

function shouldFallbackToSse(result) {
  const status = result.httpStatus;
  if (status === 404 || status === 405 || status === 406) return true;
  const err = result.initialize?.error || "";
  return /Method Not Allowed|Cannot POST|not found/i.test(err);
}

async function runHandshake(endpoint, options = {}) {
  const transport = options.transport || "auto";
  if (transport === "sse") return handshakeSse(endpoint, options);
  if (transport === "streamable-http") return handshakeStreamableHttp(endpoint, options);

  const primary = await handshakeStreamableHttp(endpoint, options);
  if (primary.initialize.ok) return primary;
  if (shouldFallbackToSse(primary)) {
    const fallback = await handshakeSse(endpoint, options);
    fallback.attempted = ["streamable-http", "sse"];
    fallback.primaryError = primary.initialize.error;
    return fallback;
  }
  return primary;
}

function roundMs(value) {
  return Math.round(value * 1000) / 1000;
}

module.exports = {
  PROTOCOL_VERSION,
  CLIENT_INFO,
  runHandshake,
  handshakeStreamableHttp,
  handshakeSse,
  interpretRpc,
};
