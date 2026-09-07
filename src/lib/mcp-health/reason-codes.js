/**
 * Actionable Streamable HTTP / silent-failure reason codes for check_mcp_health.
 */

const REASON_CODES = Object.freeze({
  WRONG_METHOD: "WRONG_METHOD",
  WRONG_ACCEPT: "WRONG_ACCEPT",
  MISSING_SESSION: "MISSING_SESSION",
  GET_VS_POST: "GET_VS_POST",
  SESSION_STICKY_MISMATCH: "SESSION_STICKY_MISMATCH",
  SILENT_EXCEPTION: "SILENT_EXCEPTION",
  EMPTY_PROTOCOL: "EMPTY_PROTOCOL",
  MALFORMED_RPC_ERROR: "MALFORMED_RPC_ERROR",
});

const REASON_HINTS = Object.freeze({
  WRONG_METHOD:
    "Send JSON-RPC with HTTP POST. GET is only for the optional SSE listen stream; PUT/PATCH/DELETE are not the message channel.",
  WRONG_ACCEPT:
    "Set Accept: application/json, text/event-stream on every Streamable HTTP request. FastMCP returns 406 otherwise.",
  MISSING_SESSION:
    "After initialize, echo the Mcp-Session-Id response header on every later request. X-Session-ID is ignored.",
  GET_VS_POST:
    "POST initialize/tools/list/tools/call to /mcp. GET /mcp only opens a server-push SSE stream and requires Accept: text/event-stream.",
  SESSION_STICKY_MISMATCH:
    "This session ID is unknown to the server. Use sticky load balancing, avoid mixing instances, and reconnect after restarts. Do not invent or reuse a stale Mcp-Session-Id.",
  SILENT_EXCEPTION:
    "HTTP 200 is not success. The server swallowed an error (common with Starlette/Uvicorn exception handlers). Return a JSON-RPC error with code and message.",
  EMPTY_PROTOCOL:
    "HTTP 200 with an empty body is not a JSON-RPC result or error. Emit { jsonrpc, id, error: { code, message } }.",
  MALFORMED_RPC_ERROR:
    "JSON-RPC errors must include integer error.code and a non-empty error.message (JSON-RPC 2.0).",
});

function previewText(text, limit = 160) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}

function messageText(posted) {
  const messages = posted?.payload?.messages || [];
  const parts = [];
  for (const msg of messages) {
    if (msg?.error?.message) parts.push(String(msg.error.message));
    else if (msg?.error) parts.push(JSON.stringify(msg.error));
  }
  if (parts.length) return parts.join(" ");
  return previewText(posted?.text || posted?.payload?.raw || "");
}

function httpUp(status) {
  return status != null && status >= 200 && status < 300;
}

function classifyHandshakeFailure(handshake) {
  const status = handshake?.httpStatus;
  const err = `${handshake?.initialize?.error || ""} ${handshake?.toolsList?.error || ""}`;
  if (status === 406 || /not acceptable|must accept text\/event-stream/i.test(err)) {
    return REASON_CODES.WRONG_ACCEPT;
  }
  if (status === 405 || /method not allowed|cannot put|cannot delete/i.test(err)) {
    return REASON_CODES.WRONG_METHOD;
  }
  if (/missing session id/i.test(err)) return REASON_CODES.MISSING_SESSION;
  if (/no valid session|session not found|unknown session|invalid session/i.test(err)) {
    return REASON_CODES.SESSION_STICKY_MISMATCH;
  }
  if (/empty body/i.test(err) && httpUp(status)) return REASON_CODES.EMPTY_PROTOCOL;
  if (/non-JSON|invalid JSON|HTML/i.test(err) && httpUp(status)) return REASON_CODES.SILENT_EXCEPTION;
  return null;
}

function classifyWrongMethod(posted) {
  const status = posted.httpStatus;
  const text = messageText(posted);
  if (status === 405 || status === 501 || status === 404) {
    return {
      matched: true,
      silent: false,
      reasonCode: REASON_CODES.WRONG_METHOD,
      observed: `HTTP ${status}${text ? ` ${text}` : ""}`,
    };
  }
  if (httpUp(status) && (posted.payload?.kind === "empty" || posted.payload?.kind === "non-json")) {
    return {
      matched: true,
      silent: true,
      reasonCode: REASON_CODES.SILENT_EXCEPTION,
      observed: `HTTP ${status} accepted PUT without a JSON-RPC error`,
    };
  }
  return {
    matched: false,
    silent: false,
    reasonCode: REASON_CODES.WRONG_METHOD,
    observed: `HTTP ${status}${text ? ` ${text}` : ""}`,
  };
}

function classifyWrongAccept(posted) {
  const status = posted.httpStatus;
  const text = messageText(posted);
  if (status === 406 || /not acceptable|must accept text\/event-stream|unsupported media|accept/i.test(text)) {
    return {
      matched: true,
      silent: false,
      reasonCode: REASON_CODES.WRONG_ACCEPT,
      observed: `HTTP ${status} ${text || "Accept rejected"}`.trim(),
    };
  }
  return {
    matched: false,
    silent: httpUp(status) && (posted.payload?.kind === "empty" || posted.payload?.kind === "non-json"),
    reasonCode: REASON_CODES.WRONG_ACCEPT,
    observed: `HTTP ${status}${text ? ` ${text}` : " (Accept not enforced)"}`,
  };
}

function classifyMissingSession(posted) {
  const status = posted.httpStatus;
  const text = messageText(posted);
  if (status === 400 && /missing session/i.test(text)) {
    return {
      matched: true,
      silent: false,
      reasonCode: REASON_CODES.MISSING_SESSION,
      observed: `HTTP ${status} ${text}`,
    };
  }
  if (/missing session id|mcp-session-id required/i.test(text)) {
    return {
      matched: true,
      silent: false,
      reasonCode: REASON_CODES.MISSING_SESSION,
      observed: `HTTP ${status} ${text}`,
    };
  }
  return {
    matched: false,
    silent: false,
    reasonCode: REASON_CODES.MISSING_SESSION,
    observed: `HTTP ${status}${text ? ` ${text}` : " (session optional / stateless)"}`,
    note: "SESSION_OPTIONAL",
  };
}

function classifyGetVsPost(posted) {
  const status = posted.httpStatus;
  const text = messageText(posted);
  const type = String(posted.contentType || "").toLowerCase();
  if (status === 405 || status === 404) {
    return {
      matched: true,
      silent: false,
      reasonCode: REASON_CODES.GET_VS_POST,
      observed: `HTTP ${status} GET is not the JSON-RPC channel`,
    };
  }
  if (status === 406 || /must accept text\/event-stream|not acceptable/i.test(text)) {
    return {
      matched: true,
      silent: false,
      reasonCode: REASON_CODES.GET_VS_POST,
      observed: `HTTP ${status} ${text || "GET requires Accept: text/event-stream"}`.trim(),
    };
  }
  if (httpUp(status) && (type.includes("text/html") || posted.payload?.kind === "non-json")) {
    return {
      matched: true,
      silent: false,
      reasonCode: REASON_CODES.GET_VS_POST,
      observed: `HTTP ${status} GET returned a page, not MCP JSON-RPC`,
    };
  }
  if (httpUp(status) && type.includes("text/event-stream")) {
    return {
      matched: false,
      silent: false,
      reasonCode: REASON_CODES.GET_VS_POST,
      observed: "GET opened an SSE listen stream (spec-allowed)",
      note: "GET_SSE_LISTEN",
    };
  }
  return {
    matched: false,
    silent: false,
    reasonCode: REASON_CODES.GET_VS_POST,
    observed: `HTTP ${status}${text ? ` ${text}` : ""}`,
  };
}

function classifyStickySession(posted) {
  const status = posted.httpStatus;
  const text = messageText(posted);
  if (
    (status === 400 || status === 404) &&
    /session|no valid|not found|unknown/i.test(text)
  ) {
    return {
      matched: true,
      silent: false,
      reasonCode: REASON_CODES.SESSION_STICKY_MISMATCH,
      observed: `HTTP ${status} ${text}`,
    };
  }
  if (/no valid session|session not found|unknown session|invalid session/i.test(text)) {
    return {
      matched: true,
      silent: false,
      reasonCode: REASON_CODES.SESSION_STICKY_MISMATCH,
      observed: `HTTP ${status} ${text}`,
    };
  }
  return {
    matched: false,
    silent: false,
    reasonCode: REASON_CODES.SESSION_STICKY_MISMATCH,
    observed: `HTTP ${status}${text ? ` ${text}` : " (session not bound / stateless)"}`,
    note: "SESSION_NOT_BOUND",
  };
}

module.exports = {
  REASON_CODES,
  REASON_HINTS,
  previewText,
  messageText,
  httpUp,
  classifyHandshakeFailure,
  classifyWrongMethod,
  classifyWrongAccept,
  classifyMissingSession,
  classifyGetVsPost,
  classifyStickySession,
};
