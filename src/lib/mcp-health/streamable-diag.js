/**
 * Streamable HTTP diagnostic matrix: wrong method/Accept, missing session,
 * GET vs POST /mcp, and session sticky mismatch.
 */

const { rawRequest, headersFor, originFrom, initializePayload, PROTOCOL_VERSION } = require("./http");
const { REASON_CODES, REASON_HINTS } = require("./reason-codes");
const {
  classifyWrongMethod,
  classifyWrongAccept,
  classifyMissingSession,
  classifyGetVsPost,
  classifyStickySession,
} = require("./reason-codes");

const UNKNOWN_SESSION = "codesentinel-unknown-session";

function baseHeaders(url, extra) {
  return {
    "MCP-Protocol-Version": PROTOCOL_VERSION,
    Origin: originFrom(url) || "http://localhost",
    ...extra,
  };
}

function initializeMessage(id, options) {
  return {
    jsonrpc: "2.0",
    id,
    method: "initialize",
    params: initializePayload(options),
  };
}

function toolsListMessage(id) {
  return { jsonrpc: "2.0", id, method: "tools/list", params: {} };
}

function annotate(id, classification) {
  return {
    id,
    reasonCode: classification.reasonCode,
    matched: Boolean(classification.matched),
    silent: Boolean(classification.silent),
    httpStatus: classification.httpStatus,
    observed: classification.observed,
    hint: REASON_HINTS[classification.reasonCode],
    note: classification.note,
  };
}

async function safeRaw(url, request) {
  try {
    return await rawRequest(url, request);
  } catch (error) {
    return { httpStatus: null, payload: { kind: "empty", messages: [] }, text: error.message, error: error.message };
  }
}

/**
 * @param {string} endpoint
 * @param {object} [options]
 */
async function runStreamableDiagnostics(endpoint, options = {}) {
  let nextId = options.probeId ?? 92001;
  const alloc = () => {
    nextId += 1;
    return nextId;
  };

  const put = await safeRaw(endpoint, {
    ...options,
    method: "PUT",
    headers: headersFor(endpoint),
    body: initializeMessage(alloc(), options),
  });
  const putClass = { ...classifyWrongMethod(put), httpStatus: put.httpStatus };

  const accept = await safeRaw(endpoint, {
    ...options,
    method: "POST",
    headers: baseHeaders(endpoint, {
      Accept: "application/json",
      "Content-Type": "application/json",
    }),
    body: initializeMessage(alloc(), options),
  });
  const acceptClass = { ...classifyWrongAccept(accept), httpStatus: accept.httpStatus };

  const missing = await safeRaw(endpoint, {
    ...options,
    method: "POST",
    headers: baseHeaders(endpoint, {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
    }),
    body: toolsListMessage(alloc()),
  });
  const missingClass = { ...classifyMissingSession(missing), httpStatus: missing.httpStatus };

  const get = await safeRaw(endpoint, {
    ...options,
    method: "GET",
    headers: baseHeaders(endpoint, { Accept: "application/json" }),
  });
  const getClass = { ...classifyGetVsPost(get), httpStatus: get.httpStatus };

  const sticky = await safeRaw(endpoint, {
    ...options,
    method: "POST",
    headers: baseHeaders(endpoint, {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      "Mcp-Session-Id": UNKNOWN_SESSION,
    }),
    body: toolsListMessage(alloc()),
  });
  const stickyClass = { ...classifyStickySession(sticky), httpStatus: sticky.httpStatus };

  const probes = [
    annotate("wrong_method", putClass),
    annotate("wrong_accept", acceptClass),
    annotate("missing_session", missingClass),
    annotate("get_vs_post", getClass),
    annotate("session_sticky_mismatch", stickyClass),
  ];

  const reasonCodes = [];
  for (const probe of probes) {
    if (probe.matched && !reasonCodes.includes(probe.reasonCode)) {
      reasonCodes.push(probe.reasonCode);
    }
  }

  return {
    probes,
    reasonCodes,
    unknownSession: UNKNOWN_SESSION,
  };
}

function streamableSilentAlarms(diagnostics) {
  if (!diagnostics?.probes) return [];
  return diagnostics.probes
    .filter((probe) => probe.silent)
    .map((probe) => ({
      type: "silent_exception",
      severity: "critical",
      step: probe.id,
      reason: `HTTP ${probe.httpStatus} on Streamable probe ${probe.id} hid the protocol failure`,
      reasonCode: probe.reasonCode || REASON_CODES.SILENT_EXCEPTION,
      hint: probe.hint,
      path: probe.id,
    }));
}

module.exports = {
  UNKNOWN_SESSION,
  runStreamableDiagnostics,
  streamableSilentAlarms,
};
