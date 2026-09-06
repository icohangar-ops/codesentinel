/**
 * Analysis engine — orchestrates code analysis and returns structured results.
 * Uses demo data when no real repo is provided (for sandbox testing).
 */

const { detectDeadCode } = require("./analyzers/dead-code");
const { detectCircularDeps } = require("./analyzers/circular-deps");
const { analyzeCoupling } = require("./analyzers/coupling");
const { detectDrift } = require("./analyzers/drift");
const { analyzeMcpHealth } = require("./analyzers/mcp-health");
const { fetchRepo } = require("./repo-fetcher");

async function runAnalysis(intent) {
  const { type, scope, repoUrl, repoProvider } = intent;

  // If we have a repo URL, fetch it (future: real clone/parse).
  // MCP protocol health talks to a remote endpoint, not a git clone.
  let repoInfo = null;
  if (type !== "mcp_health" && repoUrl) {
    try {
      repoInfo = await fetchRepo(repoUrl, repoProvider);
    } catch (err) {
      // Fall back to demo data with a note
      repoInfo = { url: repoUrl, provider: repoProvider, fallback: true };
    }
  }

  // Run the appropriate analysis
  switch (type) {
    case "dead_code":
      return detectDeadCode(repoInfo);
    case "circular_deps":
      return detectCircularDeps(repoInfo);
    case "coupling":
      return analyzeCoupling(repoInfo);
    case "drift":
      return detectDrift(repoInfo);
    case "mcp_health":
      return analyzeMcpHealth({ url: intent.mcpUrl || repoUrl });
    case "full":
      return runFullScan(repoInfo);
    default:
      return runFullScan(repoInfo);
  }
}

async function runFullScan(repoInfo) {
  const [deadCode, circularDeps, coupling, drift] = await Promise.all([
    detectDeadCode(repoInfo),
    detectCircularDeps(repoInfo),
    analyzeCoupling(repoInfo),
    detectDrift(repoInfo),
  ]);

  // Compute overall health score (0-100)
  const deadCodePenalty = Math.min(deadCode.findings.length * 2, 30);
  const cyclesPenalty = Math.min(circularDeps.findings.length * 5, 25);
  const couplingPenalty = Math.min(
    coupling.findings.filter((f) => f.severity === "critical").length * 3,
    25
  );
  const driftPenalty = Math.min(drift.findings.length * 4, 20);

  const healthScore = Math.max(0, 100 - deadCodePenalty - cyclesPenalty - couplingPenalty - driftPenalty);

  return {
    type: "full",
    description: "Complete codebase health scan",
    healthScore,
    categories: { deadCode, circularDeps, coupling, drift },
    summary: {
      totalFindings:
        deadCode.findings.length + circularDeps.findings.length + coupling.findings.length + drift.findings.length,
      criticalCount:
        [...deadCode.findings, ...circularDeps.findings, ...coupling.findings, ...drift.findings].filter(
          (f) => f.severity === "critical"
        ).length,
      warningCount:
        [...deadCode.findings, ...circularDeps.findings, ...coupling.findings, ...drift.findings].filter(
          (f) => f.severity === "warning"
        ).length,
    },
    timestamp: new Date().toISOString(),
    repo: repoInfo?.url || "workspace",
  };
}

module.exports = { runAnalysis };