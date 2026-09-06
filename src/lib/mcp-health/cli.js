#!/usr/bin/env node

/**
 * CLI: npm run mcp:health -- <url> [--transport auto|streamable-http|sse]
 *                          [--baseline file.json] [--write-baseline file.json]
 *
 * Exit 0 when no critical alarms (protocol healthy and no leaked secrets).
 */

const fs = require("node:fs");
const path = require("node:path");
const { checkMcpHealth } = require("./check");

function parseArgs(argv) {
  const args = { endpoint: null, transport: "auto", baseline: null, writeBaseline: null, timeoutMs: 10_000 };
  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (token === "--transport") args.transport = rest[++i];
    else if (token === "--baseline") args.baseline = rest[++i];
    else if (token === "--write-baseline") args.writeBaseline = rest[++i];
    else if (token === "--timeout") args.timeoutMs = Number(rest[++i]);
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
    `alarms:            ${result.alarms.length}`,
  ];
  for (const alarm of result.alarms) {
    lines.push(`  - [${alarm.severity}] ${alarm.type}: ${alarm.reason}`);
  }
  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || !args.endpoint) {
    process.stderr.write(
      "Usage: npm run mcp:health -- <url> [--transport auto|streamable-http|sse] [--baseline file] [--write-baseline file]\n"
    );
    process.exit(args.help ? 0 : 2);
  }

  const options = {
    transport: args.transport,
    timeoutMs: args.timeoutMs,
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
