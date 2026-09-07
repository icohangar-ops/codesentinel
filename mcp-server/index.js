#!/usr/bin/env node

/**
 * CodeSentinel MCP Server (stdio)
 *
 * Exposes code analysis tools via the Model Context Protocol (MCP).
 * This allows any MCP-compatible client (Claude Desktop, Cursor, Slack Agent, etc.)
 * to invoke CodeSentinel's analysis capabilities as tools.
 *
 * Tools:
 *  - analyze_dead_code: Find unused functions, classes, and modules
 *  - detect_circular_deps: Find module import cycles
 *  - analyze_coupling: Measure fan-out and identify tight clusters
 *  - detect_architectural_drift: Check layer boundary violations
 *  - full_health_scan: Run all analyses and return a health score
 *  - explain_finding: Get AI-powered explanation of a specific finding
 *  - check_mcp_health: Remote MCP handshake, silent-exception probe, Streamable HTTP reason codes
 *
 * For public HTTPS / Glama remote connectors, use mcp-server/http.js
 * (Streamable HTTP, stateless, Bearer auth).
 */

const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { createMcpServer } = require("./create-server");

async function main() {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("🔧 CodeSentinel MCP Server running on stdio");
}

main().catch(console.error);
