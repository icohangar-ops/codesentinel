/**
 * Force a known-bad tools/call (or initialize fault) and assert JSON-RPC error shape.
 * HTTP 200 with a failed/empty protocol is a silent exception.
 */

const { postRpc, initializePayload } = require("./http");
const { assessErrorShape } = require("./error-shape");
const { REASON_HINTS } = require("./reason-codes");

const SILENT_PROBE_TOOL = "__codesentinel_silent_probe_nonexistent__";
const SILENT_PROBE_METHOD = "codesentinel/force_error";

function formatProbe(assessment, method) {
  const reasonCode = assessment.reasonCode;
  return {
    method,
    ok: Boolean(assessment.ok),
    conclusive: Boolean(assessment.conclusive),
    httpStatus: assessment.httpStatus,
    httpUp: Boolean(assessment.httpUp),
    errorShape: assessment.errorShape,
    reasonCode,
    hint: reasonCode ? REASON_HINTS[reasonCode] : undefined,
    alarmType: assessment.alarmType || null,
  };
}

async function tryRpc(endpoint, message, options) {
  try {
    return await postRpc(endpoint, message, options);
  } catch (error) {
    return {
      httpStatus: null,
      payload: null,
      error: error.message,
    };
  }
}

/**
 * @param {string} endpoint
 * @param {object} [options] handshake-compatible fetch options + sessionId
 */
async function probeSilentException(endpoint, options = {}) {
  const callId = options.probeId ?? 91001;
  const sessionId = options.sessionId || null;

  const callPosted = await tryRpc(
    endpoint,
    {
      jsonrpc: "2.0",
      id: callId,
      method: "tools/call",
      params: { name: SILENT_PROBE_TOOL, arguments: { __codesentinel_probe: true } },
    },
    { ...options, sessionId }
  );
  const callAssessment = assessErrorShape(callPosted, callId);
  if (callAssessment.conclusive) {
    return formatProbe(callAssessment, "tools/call");
  }

  const unknownId = callId + 1;
  const unknownPosted = await tryRpc(
    endpoint,
    { jsonrpc: "2.0", id: unknownId, method: SILENT_PROBE_METHOD, params: {} },
    { ...options, sessionId }
  );
  const unknownAssessment = assessErrorShape(unknownPosted, unknownId);
  if (unknownAssessment.conclusive) {
    return formatProbe(unknownAssessment, SILENT_PROBE_METHOD);
  }

  const initId = callId + 2;
  const initPosted = await tryRpc(
    endpoint,
    {
      jsonrpc: "2.0",
      id: initId,
      method: "initialize",
      params: {
        protocolVersion: "",
        capabilities: "invalid",
        clientInfo: initializePayload(options).clientInfo,
      },
    },
    options
  );
  return formatProbe(assessErrorShape(initPosted, initId), "initialize");
}

function silentProbeAlarm(probe) {
  if (!probe || probe.ok || !probe.alarmType) return null;
  return {
    type: probe.alarmType,
    severity: "critical",
    step: probe.method,
    reason:
      probe.alarmType === "malformed_rpc_error"
        ? `Known-bad ${probe.method} returned a malformed JSON-RPC error (${probe.errorShape?.reason || "invalid shape"})`
        : `HTTP ${probe.httpStatus} on known-bad ${probe.method} with failed/empty protocol`,
    reasonCode: probe.reasonCode,
    hint: probe.hint,
    path: probe.method,
  };
}

module.exports = {
  SILENT_PROBE_TOOL,
  SILENT_PROBE_METHOD,
  probeSilentException,
  silentProbeAlarm,
};
