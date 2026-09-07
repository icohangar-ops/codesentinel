/**
 * Orchestrate MCP protocol health: handshake, silent-exception probe,
 * Streamable HTTP reason-code matrix, schema hash/drift, secret scan,
 * and discovery-latency metrics. HTTP 2xx never implies protocol health.
 */

const { runHandshake } = require("./handshake");
const { hashToolSchemas, compareToolSchemas } = require("./schema");
const { scanToolSecrets } = require("./secrets");
const { probeSilentException, silentProbeAlarm } = require("./silent-probe");
const { runStreamableDiagnostics, streamableSilentAlarms } = require("./streamable-diag");
const { classifyHandshakeFailure, REASON_HINTS } = require("./reason-codes");

const DEFAULT_LATENCY_WARN_MS = 5_000;

function probesEnabled(options, key) {
  if (options.probes === false) return false;
  if (options[key] === false) return false;
  return true;
}

function httpRecord(handshake) {
  const status = handshake.httpStatus;
  const reached = status != null;
  return {
    reached,
    status: status ?? null,
    up: reached && status >= 200 && status < 300,
  };
}

function uniqueCodes(codes) {
  const seen = [];
  for (const code of codes) {
    if (code && !seen.includes(code)) seen.push(code);
  }
  return seen;
}

function buildAlarms({ handshake, drift, secrets, latency, latencyWarnMs, silentProbe, streamableHttp }) {
  const alarms = [];
  const protocolHealthy = Boolean(handshake.initialize?.ok && handshake.toolsList?.ok);
  const handshakeReason = protocolHealthy ? null : classifyHandshakeFailure(handshake);

  if (!protocolHealthy) {
    alarms.push({
      type: "handshake_failed",
      severity: "critical",
      step: handshake.initialize?.ok ? "tools/list" : "initialize",
      reason: handshake.initialize?.ok
        ? handshake.toolsList.error
        : handshake.initialize.error,
      reasonCode: handshakeReason,
      hint: handshakeReason ? REASON_HINTS[handshakeReason] : undefined,
    });
  }

  const silentAlarm = silentProbeAlarm(silentProbe);
  if (silentAlarm) alarms.push(silentAlarm);
  alarms.push(...streamableSilentAlarms(streamableHttp));

  if (drift?.changed) {
    alarms.push({
      type: "schema_drift",
      severity: "warning",
      reason: "tools/list schema hash changed",
      added: drift.added,
      removed: drift.removed,
      modified: drift.modified,
      previousHash: drift.previousHash,
      currentHash: drift.currentHash,
    });
  }

  for (const finding of secrets) {
    alarms.push({
      type: "secret_in_description",
      severity: finding.severity,
      reason: finding.reason,
      path: finding.path,
      pattern: finding.pattern,
      redacted: finding.redacted,
    });
  }

  if (latency.handshakeMs > latencyWarnMs) {
    alarms.push({
      type: "discovery_slow",
      severity: "info",
      reason: `Handshake took ${latency.handshakeMs}ms (warn threshold ${latencyWarnMs}ms)`,
      handshakeMs: latency.handshakeMs,
    });
  }

  return alarms;
}

function overallOk(alarms) {
  return !alarms.some((alarm) => alarm.severity === "critical");
}

function collectReasonCodes({ handshake, silentProbe, streamableHttp, protocolHealthy }) {
  const codes = [];
  if (!protocolHealthy) {
    const classified = classifyHandshakeFailure(handshake);
    if (classified) codes.push(classified);
  }
  if (silentProbe?.reasonCode) codes.push(silentProbe.reasonCode);
  if (streamableHttp?.reasonCodes) codes.push(...streamableHttp.reasonCodes);
  return uniqueCodes(codes);
}

/**
 * @param {string} endpoint Remote MCP URL
 * @param {object} [options]
 * @param {string} [options.transport] auto | streamable-http | sse
 * @param {object|string|Array} [options.baseline] previous tools, hash, or { tools, hash }
 * @param {number} [options.timeoutMs]
 * @param {number} [options.latencyWarnMs]
 * @param {boolean} [options.probes] set false to skip silent + streamable probes
 * @param {boolean} [options.silentException]
 * @param {boolean} [options.streamableHttp]
 */
async function checkMcpHealth(endpoint, options = {}) {
  if (!endpoint || typeof endpoint !== "string") {
    throw new Error("checkMcpHealth requires an endpoint URL");
  }

  const latencyWarnMs = options.latencyWarnMs ?? DEFAULT_LATENCY_WARN_MS;
  const handshake = await runHandshake(endpoint, options);
  const tools = handshake.tools || [];
  const schemaHash = hashToolSchemas(tools);
  const drift = options.baseline != null ? compareToolSchemas(options.baseline, tools) : null;
  const secrets = scanToolSecrets(tools);
  const latency = handshake.latency || { initializeMs: 0, toolsListMs: 0, handshakeMs: 0 };

  let silentProbe = null;
  if (probesEnabled(options, "silentException")) {
    silentProbe = await probeSilentException(endpoint, {
      ...options,
      sessionId: handshake.sessionId,
    });
  }

  let streamableHttp = null;
  if (probesEnabled(options, "streamableHttp")) {
    streamableHttp = await runStreamableDiagnostics(endpoint, options);
  }

  const alarms = buildAlarms({
    handshake,
    drift,
    secrets,
    latency,
    latencyWarnMs,
    silentProbe,
    streamableHttp,
  });
  const http = httpRecord(handshake);
  const protocolHealthy = Boolean(handshake.initialize?.ok && handshake.toolsList?.ok);
  const reasonCodes = collectReasonCodes({ handshake, silentProbe, streamableHttp, protocolHealthy });

  return {
    endpoint,
    ok: overallOk(alarms),
    httpUp: http.up,
    protocolHealthy,
    http,
    transport: handshake.transport,
    sessionId: handshake.sessionId || null,
    protocol: {
      initialize: {
        ok: Boolean(handshake.initialize?.ok),
        error: handshake.initialize?.ok ? undefined : handshake.initialize?.error,
      },
      toolsList: {
        ok: Boolean(handshake.toolsList?.ok),
        error: handshake.toolsList?.ok ? undefined : handshake.toolsList?.error,
        toolCount: tools.length,
      },
    },
    schema: {
      hash: schemaHash,
      toolCount: tools.length,
      drift,
    },
    secrets,
    latency,
    silentProbe,
    streamableHttp,
    reasonCodes,
    alarms,
    tools: protocolHealthy ? tools : [],
    steps: handshake.steps,
    timestamp: new Date().toISOString(),
  };
}

module.exports = { checkMcpHealth, DEFAULT_LATENCY_WARN_MS };
