/**
 * MCP protocol health — handshake, schema drift, secret scan, discovery latency.
 *
 * Entrypoint for library consumers. HTTP 200 is not protocol health.
 */

const { checkMcpHealth, DEFAULT_LATENCY_WARN_MS } = require("./check");
const { runHandshake, handshakeStreamableHttp, handshakeSse, PROTOCOL_VERSION } = require("./handshake");
const { hashToolSchemas, compareToolSchemas, canonicalTools } = require("./schema");
const { scanToolSecrets } = require("./secrets");

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
};
