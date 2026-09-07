/**
 * JSON-RPC 2.0 error-shape checks for the silent-exception probe.
 * HTTP 200 is not protocol-honest unless a valid error object is present.
 */

const { findJsonRpcById } = require("./jsonrpc");
const { REASON_CODES, httpUp } = require("./reason-codes");

const TRANSPORT_ERROR_IDS = new Set(["server-error", null]);

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function validateJsonRpcErrorShape(message, expectedId) {
  if (!message || typeof message !== "object") {
    return { valid: false, reason: "no JSON-RPC message", idMatched: false };
  }

  const idMatched =
    message.id === expectedId || TRANSPORT_ERROR_IDS.has(message.id) || expectedId == null;
  const error = message.error;
  if (!error || typeof error !== "object") {
    return { valid: false, reason: "missing error object", idMatched, id: message.id };
  }

  const codeOk = isFiniteNumber(error.code);
  const messageOk = typeof error.message === "string" && error.message.trim().length > 0;
  if (!codeOk && !messageOk) {
    return { valid: false, reason: "error.code and error.message missing", idMatched, id: message.id };
  }
  if (!codeOk) {
    return { valid: false, reason: "error.code is not a number", idMatched, id: message.id, message: error.message };
  }
  if (!messageOk) {
    return { valid: false, reason: "error.message is empty", idMatched, id: message.id, code: error.code };
  }

  return {
    valid: true,
    idMatched,
    id: message.id,
    code: error.code,
    message: error.message,
  };
}

function pickMessage(payload, expectedId) {
  if (!payload) return null;
  const byId = findJsonRpcById(payload.messages, expectedId);
  if (byId) return byId;
  const transport = (payload.messages || []).find(
    (msg) => msg && typeof msg === "object" && TRANSPORT_ERROR_IDS.has(msg.id) && msg.error
  );
  if (transport) return transport;
  return (payload.messages || []).find((msg) => msg && typeof msg === "object") || null;
}

function assessErrorShape(posted, expectedId) {
  const status = posted?.httpStatus;
  const up = httpUp(status);
  const payload = posted?.payload;

  if (!posted || status == null) {
    return {
      ok: false,
      conclusive: false,
      gotRpcMessage: false,
      httpStatus: status ?? null,
      httpUp: false,
      reasonCode: null,
      alarmType: null,
      errorShape: { valid: false, reason: posted?.error || "no response" },
    };
  }

  if (!payload || payload.kind === "empty") {
    return {
      ok: false,
      conclusive: true,
      gotRpcMessage: false,
      httpStatus: status,
      httpUp: up,
      reasonCode: up ? REASON_CODES.EMPTY_PROTOCOL : null,
      alarmType: up ? "silent_exception" : null,
      errorShape: { valid: false, reason: `HTTP ${status} empty body` },
    };
  }

  if (payload.kind === "non-json" || payload.kind === "invalid-json") {
    return {
      ok: false,
      conclusive: true,
      gotRpcMessage: false,
      httpStatus: status,
      httpUp: up,
      reasonCode: up ? REASON_CODES.SILENT_EXCEPTION : null,
      alarmType: up ? "silent_exception" : null,
      errorShape: { valid: false, reason: payload.error || `HTTP ${status} non-JSON body` },
    };
  }

  const message = pickMessage(payload, expectedId);
  if (!message) {
    return {
      ok: false,
      conclusive: true,
      gotRpcMessage: false,
      httpStatus: status,
      httpUp: up,
      reasonCode: up ? REASON_CODES.EMPTY_PROTOCOL : null,
      alarmType: up ? "silent_exception" : null,
      errorShape: { valid: false, reason: `HTTP ${status} had no JSON-RPC message` },
    };
  }

  if (message.result !== undefined && !message.error) {
    return {
      ok: false,
      conclusive: true,
      gotRpcMessage: true,
      httpStatus: status,
      httpUp: up,
      reasonCode: REASON_CODES.SILENT_EXCEPTION,
      alarmType: "silent_exception",
      errorShape: { valid: false, reason: "known-bad call returned a JSON-RPC result", id: message.id },
    };
  }

  const errorShape = validateJsonRpcErrorShape(message, expectedId);
  if (errorShape.valid) {
    return {
      ok: true,
      conclusive: true,
      gotRpcMessage: true,
      httpStatus: status,
      httpUp: up,
      reasonCode: null,
      alarmType: null,
      errorShape,
    };
  }

  return {
    ok: false,
    conclusive: true,
    gotRpcMessage: true,
    httpStatus: status,
    httpUp: up,
    reasonCode: REASON_CODES.MALFORMED_RPC_ERROR,
    alarmType: "malformed_rpc_error",
    errorShape,
  };
}

module.exports = {
  TRANSPORT_ERROR_IDS,
  validateJsonRpcErrorShape,
  pickMessage,
  assessErrorShape,
};
