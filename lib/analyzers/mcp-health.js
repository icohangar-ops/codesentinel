/**
 * Analyzer wrapper for remote MCP protocol health.
 * Uses src/lib/mcp-health — HTTP uptime is not treated as a passing scan.
 */

const { checkMcpHealth, REASON_HINTS } = require("../../src/lib/mcp-health");

function suggestionFor(alarm) {
  if (alarm.hint) return alarm.hint;
  if (alarm.reasonCode && REASON_HINTS[alarm.reasonCode]) return REASON_HINTS[alarm.reasonCode];
  if (alarm.type === "handshake_failed") {
    return "Do not trust HTTP 200. Confirm initialize + tools/list over Streamable HTTP or SSE.";
  }
  if (alarm.type === "schema_drift") {
    return "Review tools/list changes and update the schema baseline if the drift is intended.";
  }
  if (alarm.type === "secret_in_description") {
    return "Remove credentials from tool descriptions/schemas before they enter agent context.";
  }
  if (alarm.type === "silent_exception") {
    return REASON_HINTS.SILENT_EXCEPTION;
  }
  if (alarm.type === "malformed_rpc_error") {
    return REASON_HINTS.MALFORMED_RPC_ERROR;
  }
  return "Investigate handshake latency or reduce tool-list payload size.";
}

function findingsFromCheck(check) {
  return (check.alarms || []).map((alarm) => ({
    type: alarm.type,
    severity: alarm.severity,
    name: alarm.reasonCode || alarm.type,
    reason: alarm.reason,
    description: alarm.reason,
    suggestion: suggestionFor(alarm),
    reasonCode: alarm.reasonCode,
    hint: alarm.hint,
    path: alarm.path,
    pattern: alarm.pattern,
    redacted: alarm.redacted,
    added: alarm.added,
    removed: alarm.removed,
    modified: alarm.modified,
  }));
}

async function analyzeMcpHealth(target, options = {}) {
  const endpoint = options.endpoint || target?.url || target?.endpoint || process.env.MCP_HEALTH_URL;
  if (!endpoint) {
    return {
      type: "mcp_health",
      description: "Remote MCP protocol health",
      findings: [
        {
          type: "missing_endpoint",
          severity: "warning",
          name: "missing_endpoint",
          reason: "No MCP endpoint URL was provided.",
          suggestion: "Pass an MCP URL (https://host/mcp) or set MCP_HEALTH_URL.",
        },
      ],
      stats: { httpUp: false, protocolHealthy: false, toolCount: 0 },
      timestamp: new Date().toISOString(),
      repo: "n/a",
    };
  }

  const check = await checkMcpHealth(endpoint, {
    transport: options.transport,
    baseline: options.baseline,
    timeoutMs: options.timeoutMs,
    headers: options.headers,
    latencyWarnMs: options.latencyWarnMs,
    probes: options.probes,
    silentException: options.silentException,
    streamableHttp: options.streamableHttp,
  });

  const silentFailed = check.silentProbe && !check.silentProbe.ok && check.silentProbe.alarmType;
  const description = silentFailed
    ? "Remote MCP handshake may look fine, but a known-bad tools/call was swallowed (HTTP 200 is not an error shape)"
    : check.protocolHealthy
      ? "Remote MCP handshake succeeded (initialize + tools/list)"
      : "Remote MCP protocol health failed — HTTP uptime is not sufficient";

  return {
    type: "mcp_health",
    description,
    findings: findingsFromCheck(check),
    stats: {
      httpUp: check.httpUp ? 1 : 0,
      protocolHealthy: check.protocolHealthy ? 1 : 0,
      toolCount: check.schema.toolCount,
      initializeMs: check.latency.initializeMs,
      toolsListMs: check.latency.toolsListMs,
      handshakeMs: check.latency.handshakeMs,
      alarmCount: check.alarms.length,
      secretCount: check.secrets.length,
      silentProbeOk: check.silentProbe ? (check.silentProbe.ok ? 1 : 0) : null,
      streamableMatched: check.streamableHttp
        ? check.streamableHttp.probes.filter((p) => p.matched).length
        : 0,
      reasonCodeCount: (check.reasonCodes || []).length,
    },
    schemaHash: check.schema.hash,
    check,
    timestamp: check.timestamp,
    repo: endpoint,
  };
}

module.exports = { analyzeMcpHealth, findingsFromCheck };
