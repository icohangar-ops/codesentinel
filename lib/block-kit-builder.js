/**
 * Block Kit response builder — creates rich Slack messages from analysis results.
 */

const SEVERITY_EMOJI = { critical: "🔴", warning: "🟡", info: "🔵" };
const SEVERITY_COLOR = { critical: "danger", warning: "warning", info: "primary" };

function buildResponseBlocks(results, intent, aiSummary) {
  const blocks = [];

  // Header
  blocks.push(headerBlock(results));

  // AI Summary (if available)
  if (aiSummary) {
    blocks.push({
      type: "rich_text",
      block_id: "ai_summary",
      elements: [
        {
          type: "rich_text_section",
          elements: [{ type: "text", text: String(aiSummary).slice(0, 2900) }],
        },
      ],
    });
    blocks.push(divider());
  }

  // For full scan, show summary cards
  if (results.type === "full" && results.healthScore !== undefined) {
    blocks.push(healthScoreBlock(results.healthScore));
    const catSummary = categorySummaryBlocks(results);
    if (catSummary) blocks.push(catSummary);
    blocks.push(divider());
  }

  // Findings
  if (results.findings) {
    blocks.push(...findingsBlocks(results));
  }

  // Category details for full scan
  if (results.categories) {
    for (const [catName, catResults] of Object.entries(results.categories)) {
      if (catResults.findings && catResults.findings.length > 0) {
        blocks.push(...categoryDetailBlock(catName, catResults));
        blocks.push(divider());
      }
    }
  }

  // Stats footer
  if (results.stats) {
    const sb = statsBlock(results.stats);
    if (sb) blocks.push(sb);
  }

  // Timestamp
  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: `:clock1: Analyzed ${new Date().toLocaleString()} | Repo: ${results.repo || "workspace"}`,
      },
    ],
  });

  return blocks;
}

function headerBlock(results) {
  const typeLabels = {
    dead_code: "🔍 Dead Code Analysis",
    circular_deps: "🔁 Circular Dependencies",
    coupling: "📊 Coupling Metrics",
    drift: "🏗️ Architectural Drift",
    mcp_health: "🔌 MCP Protocol Health",
    full: "🩺 Full Codebase Health Scan",
  };

  return {
    type: "header",
    text: {
      type: "plain_text",
      text: typeLabels[results.type] || "CodeSentinel Analysis",
      emoji: true,
    },
  };
}

function healthScoreBlock(score) {
  const emoji = score >= 80 ? "🟢" : score >= 60 ? "🟡" : "🔴";
  const label = score >= 80 ? "Healthy" : score >= 60 ? "Needs Attention" : "Critical";

  return {
    type: "section",
    block_id: "health_score",
    text: {
      type: "mrkdwn",
      text: `*Overall Health Score: ${emoji} ${score}/100 — ${label}*`,
    },
    accessory: {
      type: "button",
      text: { type: "plain_text", text: "Re-scan" },
      action_id: "rescan_trigger",
      style: score >= 60 ? "primary" : "danger",
    },
  };
}

function categorySummaryBlocks(results) {
  const cats = results.categories;
  if (!cats) return null;

  return {
    type: "section",
    text: {
      type: "mrkdwn",
      text: [
        `*Category Breakdown:*`,
        `• Dead code: ${SEVERITY_EMOJI[cats.deadCode.findings.length > 0 ? "warning" : "info"]} ${cats.deadCode.findings.length} findings (${cats.deadCode.stats.estimatedDeadLOC || 0} LOC)`,
        `• Circular deps: ${SEVERITY_EMOJI[cats.circularDeps.findings.length > 0 ? "critical" : "info"]} ${cats.circularDeps.findings.length} cycles`,
        `• Coupling: ${SEVERITY_EMOJI[cats.coupling.findings.filter(f => f.severity === "critical").length > 0 ? "warning" : "info"]} ${cats.coupling.stats.modulesAboveThreshold || 0} modules above threshold`,
        `• Arch. drift: ${SEVERITY_EMOJI[cats.drift.findings.length > 0 ? "warning" : "info"]} ${cats.drift.stats.criticalViolations || 0} critical violations`,
      ].join("\n"),
    },
  };
}

function findingsBlocks(results) {
  const blocks = [];
  const findings = results.findings || [];

  if (findings.length === 0) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "✅ No issues found! Your codebase looks healthy." },
    });
    return blocks;
  }

  // Show up to 5 findings with expandable details
  for (const finding of findings.slice(0, 5)) {
    const emoji = SEVERITY_EMOJI[finding.severity] || "⚪";

    let text = "";
    if (finding.type === "cycle") {
      text = `${emoji} *${finding.description}*\n${finding.cycle.map((p) => `  → \`${p}\``).join("\n")}`;
    } else if (finding.fanOut) {
      text = `${emoji} *\`${finding.module}\`* — fan-out: *${finding.fanOut}* (threshold: ${finding.threshold})`;
    } else if (finding.couplingScore) {
      text = `${emoji} *${finding.clusterName}* — coupling score: *${finding.couplingScore}* (${finding.modules.length} modules)`;
    } else {
      const location = finding.file ? ` in \`${finding.file}\`${finding.line ? `:${finding.line}` : ""}` : "";
      text = `${emoji} *\`${finding.name || "unknown"}\`*${location}\n> ${finding.reason || finding.description}`;
    }

    const block = {
      type: "section",
      text: { type: "mrkdwn", text },
    };

    // Add suggestion as context if available
    if (finding.suggestion) {
      blocks.push(block);
      blocks.push({
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: `:bulb: *Fix:* ${finding.suggestion}`,
          },
        ],
      });
    } else {
      blocks.push(block);
    }
  }

  if (findings.length > 5) {
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: `:information_source: Showing 5 of ${findings.length} total findings. Connect a repo for full analysis.`,
        },
      ],
    });
  }

  return blocks;
}

function categoryDetailBlock(catName, catResults) {
  const labels = {
    deadCode: "🔍 Dead Code Details",
    circularDeps: "🔁 Circular Dependency Details",
    coupling: "📊 Coupling Details",
    drift: "🏗️ Architectural Drift Details",
  };

  const blocks = [];
  blocks.push({
    type: "section",
    text: { type: "mrkdwn", text: `*${labels[catName] || catName}*` },
  });

  for (const f of (catResults.findings || []).slice(0, 3)) {
    const emoji = SEVERITY_EMOJI[f.severity] || "⚪";
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${emoji} ${f.description || f.reason || `${f.name || f.module} — ${f.type}`}`,
      },
    });
  }

  return blocks;
}

function statsBlock(stats) {
  const lines = [];
  for (const [key, value] of Object.entries(stats)) {
    if (typeof value === "number") {
      const label = key.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase());
      lines.push(`• ${label}: *${value}*`);
    }
  }
  if (lines.length === 0) return null;

  return {
    type: "section",
    text: { type: "mrkdwn", text: `*Metrics:*\n${lines.join("\n")}` },
  };
}

function divider() {
  return { type: "divider" };
}

module.exports = { buildResponseBlocks };