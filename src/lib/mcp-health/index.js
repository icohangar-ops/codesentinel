/**
 * MCP protocol health — handshake, silent-exception probe, Streamable HTTP
 * reason codes, schema drift, secret scan, discovery latency.
 *
 * Entrypoint for library consumers. HTTP 200 is not protocol health.
 */

const { checkMcpHealth, DEFAULT_LATENCY_WARN_MS } = require("./check");
const { runHandshake, handshakeStreamableHttp, handshakeSse, PROTOCOL_VERSION } = require("./handshake");
const { hashToolSchemas, compareToolSchemas, canonicalTools } = require("./schema");
const { scanToolSecrets } = require("./secrets");
const { probeSilentException, SILENT_PROBE_TOOL } = require("./silent-probe");
const { runStreamableDiagnostics } = require("./streamable-diag");
const { REASON_CODES, REASON_HINTS, classifyHandshakeFailure } = require("./reason-codes");
const { validateJsonRpcErrorShape, assessErrorShape } = require("./error-shape");

module.exports = {
  checkMcpHealth,
  DEFAULT_LATENCY_WARN_MS,
  runHandshake,
  handshakeStreamableHttp,
  handshakeSse,
  PROTOCOL_VERSION,
  hashToolSchemas,
  compareToolSchemas,
  canonicalTools,
  scanToolSecrets,
  probeSilentException,
  SILENT_PROBE_TOOL,
  runStreamableDiagnostics,
  REASON_CODES,
  REASON_HINTS,
  classifyHandshakeFailure,
  validateJsonRpcErrorShape,
  assessErrorShape,
};
