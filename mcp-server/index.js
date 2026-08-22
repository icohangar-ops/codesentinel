#!/usr/bin/env node

/**
 * CodeSentinel MCP Server
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
 */

const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { z } = require("zod");

// Import analyzers
const { detectDeadCode } = require("../lib/analyzers/dead-code");
const { detectCircularDeps } = require("../lib/analyzers/circular-deps");
const { analyzeCoupling } = require("../lib/analyzers/coupling");
const { detectDrift } = require("../lib/analyzers/drift");
const { resolveRepo } = require("../lib/mcp-repo");

const { version: packageVersion } = require("../package.json");

const server = new McpServer({
  name: "CodeSentinel",
  version: packageVersion,
  description: "AI-powered codebase health analysis — dead code, circular deps, coupling, architectural drift",
});

// Tool 1: Dead Code Analysis
server.tool(
  "analyze_dead_code",
  "Analyze a codebase for dead code — functions, classes, and modules that are defined but never referenced. Returns findings with file paths, line numbers, severity, and fix suggestions.",
  {
    repo_path: z.string().optional().describe("Path or URL to the repository to analyze"),
    include_suggestions: z.boolean().default(true).describe("Whether to include fix suggestions"),
  },
  async ({ repo_path, include_suggestions }) => {
    const repoInfo = await resolveRepo(repo_path);
    const results = detectDeadCode(repoInfo);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              type: results.type,
              findings: include_suggestions
                ? results.findings
                : results.findings.map(({ suggestion, ...rest }) => rest),
              stats: results.stats,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// Tool 2: Circular Dependency Detection
server.tool(
  "detect_circular_deps",
  "Detect circular dependencies between modules using DFS-based cycle detection. Returns cycles with involved files and impact assessment.",
  {
    repo_path: z.string().optional().describe("Path or URL to the repository"),
  },
  async ({ repo_path }) => {
    const repoInfo = await resolveRepo(repo_path);
    const results = detectCircularDeps(repoInfo);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              type: results.type,
              findings: results.findings,
              stats: results.stats,
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// Tool 3: Coupling Analysis
server.tool(
  "analyze_coupling",
  "Analyze coupling metrics across the codebase. Identifies modules with high fan-out (too many dependencies) and tightly coupled clusters.",
  {
    repo_path: z.string().optional().describe("Path or URL to the repository"),
    fan_out_threshold: z.number().default(10).describe("Fan-out threshold for flagging modules"),
  },
  async ({ repo_path, fan_out_threshold }) => {
    const repoInfo = await resolveRepo(repo_path);
    const results = analyzeCoupling(repoInfo);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              type: results.type,
              findings: results.findings,
              stats: { ...results.stats, configuredThreshold: fan_out_threshold },
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// Tool 4: Architectural Drift Detection
server.tool(
  "detect_architectural_drift",
  "Detect architectural drift — violations of intended layer boundaries (e.g., UI importing from data layer, reverse dependencies).",
  {
    repo_path: z.string().optional().describe("Path or URL to the repository"),
    layers_config: z
      .string()
      .optional()
      .describe('JSON string defining layer patterns, e.g. {"ui": ["src/components/"], "data": ["src/db/"]}'),
  },
  async ({ repo_path, layers_config }) => {
    const repoInfo = await resolveRepo(repo_path);
    const results = detectDrift(repoInfo);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              type: results.type,
              findings: results.findings,
              stats: results.stats,
              layers_config: layers_config ? JSON.parse(layers_config) : "default (ui, business, data, shared)",
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// Tool 5: Full Health Scan
server.tool(
  "full_health_scan",
  "Run a complete codebase health scan: dead code, circular dependencies, coupling metrics, and architectural drift. Returns an overall health score (0-100) and prioritized findings.",
  {
    repo_path: z.string().optional().describe("Path or URL to the repository"),
  },
  async ({ repo_path }) => {
    const repoInfo = await resolveRepo(repo_path);
    const [deadCode, circularDeps, coupling, drift] = await Promise.all([
      Promise.resolve(detectDeadCode(repoInfo)),
      Promise.resolve(detectCircularDeps(repoInfo)),
      Promise.resolve(analyzeCoupling(repoInfo)),
      Promise.resolve(detectDrift(repoInfo)),
    ]);

    const deadCodePenalty = Math.min(deadCode.findings.length * 2, 30);
    const cyclesPenalty = Math.min(circularDeps.findings.length * 5, 25);
    const couplingPenalty = Math.min(
      coupling.findings.filter((f) => f.severity === "critical").length * 3,
      25
    );
    const driftPenalty = Math.min(drift.findings.length * 4, 20);
    const healthScore = Math.max(0, 100 - deadCodePenalty - cyclesPenalty - couplingPenalty - driftPenalty);

    const allFindings = [...deadCode.findings, ...circularDeps.findings, ...coupling.findings, ...drift.findings];

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            {
              type: "full",
              healthScore,
              healthGrade:
                healthScore >= 80 ? "A" : healthScore >= 60 ? "B" : healthScore >= 40 ? "C" : "D",
              categories: {
                deadCode: { count: deadCode.findings.length, critical: deadCode.findings.filter((f) => f.severity === "critical").length },
                circularDeps: { count: circularDeps.findings.length, critical: circularDeps.findings.filter((f) => f.severity === "critical").length },
                coupling: { count: coupling.findings.filter((f) => f.type === "high_fan_out").length, critical: coupling.findings.filter((f) => f.severity === "critical").length },
                drift: { count: drift.findings.length, critical: drift.findings.filter((f) => f.severity === "critical").length },
              },
              summary: {
                totalFindings: allFindings.length,
                criticalCount: allFindings.filter((f) => f.severity === "critical").length,
                warningCount: allFindings.filter((f) => f.severity === "warning").length,
                infoCount: allFindings.filter((f) => f.severity === "info").length,
              },
              topPriorities: allFindings
                .filter((f) => f.suggestion)
                .sort((a, b) => {
                  const severityOrder = { critical: 0, warning: 1, info: 2 };
                  return (severityOrder[a.severity] || 2) - (severityOrder[b.severity] || 2);
                })
                .slice(0, 5)
                .map((f) => ({
                  severity: f.severity,
                  issue: f.description || f.reason || f.name,
                  fix: f.suggestion,
                })),
            },
            null,
            2
          ),
        },
      ],
    };
  }
);

// Tool 6: Explain Finding (AI-powered)
server.tool(
  "explain_finding",
  "Get a detailed explanation of a specific code health finding, including why it matters, potential risks, and detailed remediation steps.",
  {
    finding_type: z.enum(["dead_code", "circular_dependency", "high_coupling", "architectural_drift"]),
    finding_description: z.string().describe("Description of the specific finding to explain"),
    codebase_context: z.string().optional().describe("Additional context about the codebase (language, framework, etc.)"),
  },
  async ({ finding_type, finding_description, codebase_context }) => {
    const explanation = generateExplanation(finding_type, finding_description, codebase_context);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ type: finding_type, explanation }, null, 2),
        },
      ],
    };
  }
);

function generateExplanation(type, description, context) {
  const explanations = {
    dead_code: {
      why: "Dead code increases the maintenance burden by making the codebase harder to understand and navigate. It also inflates bundle sizes and can confuse new team members about which code paths are actually in use.",
      risks: [
        "Developers may waste time debugging or testing dead code paths",
        "Dead code can mask bugs by making code coverage metrics misleading",
        "Increases cognitive load during code reviews",
        "In compiled languages, dead code may still be compiled, increasing binary size",
      ],
      remediation: [
        "Verify the code is truly unreferenced using static analysis (not just grep)",
        "Check for any dynamic imports or reflection-based usage",
        "Remove incrementally with focused PRs per module area",
        "Run full test suite after each removal to catch any missed references",
      ],
    },
    circular_dependency: {
      why: "Circular dependencies create tightly coupled modules that cannot be tested, reused, or understood in isolation. They can cause initialization order bugs, prevent tree-shaking, and make refactoring extremely risky.",
      risks: [
        "Runtime errors due to undefined exports during module initialization",
        "Inability to unit test modules independently",
        "Tree-shaking failures in bundlers (dead code can't be eliminated)",
        "Difficulty in understanding the dependency graph",
        "Potential infinite recursion in lazy-loaded modules",
      ],
      remediation: [
        "Identify the shared dependency and extract it to a third module",
        "Use dependency injection to break the cycle at runtime",
        "Apply the mediator pattern to decouple direct references",
        "Restructure using events/pub-sub instead of direct imports",
      ],
    },
    high_coupling: {
      why: "High coupling means a module depends on many other modules. Changes to any of those dependencies can break the coupled module, making the system fragile and expensive to maintain.",
      risks: [
        "A single change can cascade across many modules",
        "Difficult to understand the full impact of changes",
        "Testing requires complex setup with many mocks/stubs",
        "Reusability is severely limited",
        "Merge conflicts increase with the number of dependencies",
      ],
      remediation: [
        "Apply the Facade pattern to group related dependencies",
        "Use dependency inversion (depend on abstractions, not concretions)",
        "Extract cohesive sub-modules with well-defined interfaces",
        "Consider event-driven architecture for cross-cutting concerns",
      ],
    },
    architectural_drift: {
      why: "Architectural drift occurs when the actual code structure diverges from the intended architecture over time. This makes the system harder to reason about, test, and evolve.",
      risks: [
        "Loss of architectural benefits (testability, maintainability, deployability)",
        "Creates hidden dependencies that are hard to discover",
        "Makes onboarding new developers more difficult",
        "Can lead to security issues (e.g., UI layer directly accessing databases)",
        "Increases the cost of future refactoring",
      ],
      remediation: [
        "Add architectural linting rules (e.g., eslint-plugin-boundaries)",
        "Document the intended architecture and make it visible to the team",
        "Create migration plan to gradually move violating imports",
        "Use dependency injection to enforce layer boundaries at compile time",
      ],
    },
  };

  const info = explanations[type] || explanations.dead_code;
  return {
    finding: description,
    context: context || "general codebase",
    ...info,
  };
}

// Start the MCP server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("🔧 CodeSentinel MCP Server running on stdio");
}

main().catch(console.error);