/**
 * Analyzer wrapper for remote MCP protocol health.
 * Uses src/lib/mcp-health — HTTP uptime is not treated as a passing scan.
 */

const { checkMcpHealth } = require("../../src/lib/mcp-health");

function findingsFromCheck(check) {
  return (check.alarms || []).map((alarm) => ({
    type: alarm.type,
    severity: alarm.severity,
    name: alarm.type,
    reason: alarm.reason,
    description: alarm.reason,
    suggestion:
      alarm.type === "handshake_failed"
        ? "Do not trust HTTP 200. Confirm initialize + tools/list over Streamable HTTP or SSE."
        : alarm.type === "schema_drift"
          ? "Review tools/list changes and update the schema baseline if the drift is intended."
          : alarm.type === "secret_in_description"
            ? "Remove credentials from tool descriptions/schemas before they enter agent context."
            : "Investigate handshake latency or reduce tool-list payload size.",
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
  });

  return {
    type: "mcp_health",
    description: check.protocolHealthy
      ? "Remote MCP handshake succeeded (initialize + tools/list)"
      : "Remote MCP protocol health failed — HTTP uptime is not sufficient",
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
    },
    schemaHash: check.schema.hash,
    check,
    timestamp: check.timestamp,
    repo: endpoint,
  };
}

module.exports = { analyzeMcpHealth, findingsFromCheck };
