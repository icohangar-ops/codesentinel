/**
 * Parse user message into a structured analysis intent.
 */

const INTENT_PATTERNS = {
  mcp_health: {
    keywords: [
      "mcp health",
      "mcp handshake",
      "mcp protocol",
      "remote mcp",
      "tools/list",
      "schema drift",
      "mcp endpoint",
    ],
    description: "Checking remote MCP protocol health (initialize + tools/list, not HTTP uptime)",
  },
  dead_code: {
    keywords: ["dead code", "unused", "unreferenced", "orphan", "dead function", "dead class", "dead module"],
    description: "Scanning for dead code — definitions that are never referenced",
  },
  circular_deps: {
    keywords: ["circular", "cycle", "cyclic", "dependency cycle", "circular dependency", "import cycle"],
    description: "Detecting circular dependencies between modules",
  },
  coupling: {
    keywords: ["coupling", "fan-out", "coupled", "dependency graph", "module dependency", "tightly coupled"],
    description: "Analyzing coupling metrics and fan-out",
  },
  drift: {
    keywords: ["drift", "architectural", "layer", "boundary", "violation", "architecture", "clean architecture", "layer violation"],
    description: "Checking for architectural drift and layer boundary violations",
  },
  full: {
    keywords: ["full", "health", "scan", "complete", "all", "comprehensive", "health check", "full scan"],
    description: "Running complete codebase health scan",
  },
};

const URL_PATTERNS = {
  github: /https?:\/\/github\.com\/[\w.-]+\/[\w.-]+/,
  gitlab: /https?:\/\/gitlab\.com\/[\w.-]+\/[\w.-]+/,
  self_hosted_gitlab: /https?:\/\/[\w.-]+\/[\w.-]+\/[\w.-]+\/-\/tree/,
};

function parseAnalysisRequest(text) {
  const lower = text.toLowerCase();

  // Detect analysis type
  let type = "unknown";
  let description = "";
  for (const [intentType, config] of Object.entries(INTENT_PATTERNS)) {
    if (config.keywords.some((kw) => lower.includes(kw))) {
      type = intentType;
      description = config.description;
      break;
    }
  }

  // Detect scope (repo URL or workspace context)
  let scope = "full";
  let repoUrl = null;
  let repoProvider = null;

  for (const [provider, pattern] of Object.entries(URL_PATTERNS)) {
    const match = text.match(pattern);
    if (match) {
      repoUrl = match[0];
      repoProvider = provider;
      scope = repoUrl;
      break;
    }
  }

  // Detect specific scope mentions
  const scopePatterns = [
    { pattern: /(?:in|on|for)\s+(?:the\s+)?(?:frontend|client|ui|web|components?)/i, scope: "frontend" },
    { pattern: /(?:in|on|for)\s+(?:the\s+)?(?:backend|server|api|services?)/i, scope: "backend" },
    { pattern: /(?:in|on|for)\s+(?:the\s+)?(?:this|current)\s+(?:repo|project|codebase|repository)/i, scope: "workspace" },
  ];

  if (!repoUrl) {
    for (const sp of scopePatterns) {
      if (sp.pattern.test(text)) {
        scope = sp.scope;
        break;
      }
    }
  }

  const genericUrl = text.match(/https?:\/\/[^\s>|]+/);
  const mcpUrl = type === "mcp_health" ? (genericUrl ? genericUrl[0] : repoUrl) : null;

  return {
    type,
    description: description || "Custom analysis request",
    scope,
    repoUrl,
    repoProvider,
    mcpUrl,
    rawText: text,
  };
}

module.exports = { parseAnalysisRequest, INTENT_PATTERNS };