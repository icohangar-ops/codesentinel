/**
 * Process-safe server identity. Keep this free of ESM-only packages so
 * GET /health can load without pulling the MCP SDK, Octokit, or tool graph.
 */

const SERVER_INFO = {
  name: "CodeSentinel",
  version: "1.0.0",
  description: "AI-powered codebase health analysis — dead code, circular deps, coupling, architectural drift",
};

module.exports = { SERVER_INFO };
