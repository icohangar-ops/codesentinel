#!/usr/bin/env node

/**
 * CLI: npm run mcp:health -- <url> [--transport auto|streamable-http|sse]
 *                          [--baseline file.json] [--write-baseline file.json]
 *                          [--no-probes] [--no-silent-probe] [--no-streamable-diag]
 *
 * Exit 0 when no critical alarms (protocol healthy, honest error shape, no leaked secrets).
 */

const fs = require("node:fs");
const path = require("node:path");
const { checkMcpHealth } = require("./check");

function parseArgs(argv) {
  const args = {
    endpoint: null,
    transport: "auto",
    baseline: null,
    writeBaseline: null,
    timeoutMs: 10_000,
    probes: true,
    silentException: true,
    streamableHttp: true,
  };
  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (token === "--transport") args.transport = rest[++i];
    else if (token === "--baseline") args.baseline = rest[++i];
    else if (token === "--write-baseline") args.writeBaseline = rest[++i];
    else if (token === "--timeout") args.timeoutMs = Number(rest[++i]);
    else if (token === "--no-probes") args.probes = false;
    else if (token === "--no-silent-probe") args.silentException = false;
    else if (token === "--no-streamable-diag") args.streamableHttp = false;
    else if (!token.startsWith("-") && !args.endpoint) args.endpoint = token;
    else if (token === "--help" || token === "-h") args.help = true;
  }
  return args;
}

function loadBaseline(file) {
  const raw = fs.readFileSync(path.resolve(file), "utf8");
  return JSON.parse(raw);
}

function summarize(result) {
  const lines = [
    `endpoint:          ${result.endpoint}`,
    `http up:           ${result.httpUp} (status ${result.http.status ?? "n/a"})`,
    `protocol healthy:  ${result.protocolHealthy}`,
    `transport:         ${result.transport}`,
    `schema hash:       ${result.schema.hash}`,
    `tools:             ${result.schema.toolCount}`,
    `initialize:        ${result.latency.initializeMs}ms`,
    `tools/list:        ${result.latency.toolsListMs}ms`,
    `handshake:         ${result.latency.handshakeMs}ms`,
    `reason codes:      ${(result.reasonCodes || []).join(", ") || "(none)"}`,
    `alarms:            ${result.alarms.length}`,
  ];

  if (result.silentProbe) {
    const probe = result.silentProbe;
    const shape = probe.ok
      ? `JSON-RPC error ${probe.errorShape?.code} ${probe.errorShape?.message || ""}`.trim()
      : probe.reasonCode || probe.errorShape?.reason || "failed";
    lines.push(`silent probe:      ${probe.ok ? "ok" : "ALARM"} (${probe.method}) ${shape}`);
  }

  if (result.streamableHttp?.probes) {
    lines.push("streamable HTTP:");
    for (const probe of result.streamableHttp.probes) {
      const flag = probe.silent ? "SILENT" : probe.matched ? "matched" : "—";
      lines.push(`  - ${probe.reasonCode.padEnd(24)} ${flag.padEnd(8)} HTTP ${probe.httpStatus ?? "n/a"}  ${probe.hint}`);
    }
  }

  for (const alarm of result.alarms) {
    const code = alarm.reasonCode ? ` ${alarm.reasonCode}` : "";
    lines.push(`  - [${alarm.severity}] ${alarm.type}${code}: ${alarm.reason}`);
  }
  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.endpoint) {
    process.stderr.write(
      "Usage: npm run mcp:health -- <url> [--transport auto|streamable-http|sse] [--baseline file] [--write-baseline file] [--no-probes]\n"
    );
    process.exit(args.help ? 0 : 2);
  }

  const options = {
    transport: args.transport,
    timeoutMs: args.timeoutMs,
    probes: args.probes,
    silentException: args.silentException,
    streamableHttp: args.streamableHttp,
  };
  if (args.baseline) options.baseline = loadBaseline(args.baseline);

  const result = await checkMcpHealth(args.endpoint, options);
  process.stderr.write(`${summarize(result)}\n\n`);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);

  if (args.writeBaseline && result.protocolHealthy) {
    const snapshot = { hash: result.schema.hash, tools: result.tools, timestamp: result.timestamp };
    fs.writeFileSync(path.resolve(args.writeBaseline), `${JSON.stringify(snapshot, null, 2)}\n`);
    process.stderr.write(`wrote baseline ${args.writeBaseline}\n`);
  }

  process.exit(result.ok ? 0 : 1);
}

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(2);
});
