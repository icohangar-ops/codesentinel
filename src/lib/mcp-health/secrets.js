/**
 * Scan MCP tool names, descriptions, and schemas for credential-like strings
 * before those fields enter agent context.
 */

const PATTERNS = [
  { id: "aws_access_key", label: "AWS access key", severity: "critical", regex: /\bAKIA[0-9A-Z]{16}\b/g },
  { id: "github_pat", label: "GitHub personal access token", severity: "critical", regex: /\bghp_[A-Za-z0-9]{20,}\b/g },
  { id: "github_fine_grained", label: "GitHub fine-grained token", severity: "critical", regex: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g },
  { id: "slack_token", label: "Slack token", severity: "critical", regex: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g },
  { id: "openai_key", label: "OpenAI-style secret key", severity: "critical", regex: /\bsk-(?:proj-)?[A-Za-z0-9]{20,}\b/g },
  { id: "private_key", label: "PEM private key", severity: "critical", regex: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/g },
  { id: "connection_string", label: "Database connection string", severity: "critical", regex: /\b(?:postgres|postgresql|mysql|mongodb|redis|amqp):\/\/[^\s"'<>]+:[^\s"'<>]+@/gi },
  { id: "bearer_token", label: "Bearer token", severity: "critical", regex: /\bBearer\s+[A-Za-z0-9._\-]{20,}/g },
  { id: "jwt", label: "JWT", severity: "warning", regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { id: "generic_api_key", label: "API key assignment", severity: "warning", regex: /\b(?:api[_-]?key|secret[_-]?key|access[_-]?token)\s*[:=]\s*['"]?[A-Za-z0-9_\-]{16,}/gi },
];

function redact(match) {
  if (!match) return "";
  if (match.length <= 8) return "****";
  return `${match.slice(0, 4)}…${match.slice(-2)}`;
}

function walkStrings(value, path, visit) {
  if (typeof value === "string") {
    visit(path, value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkStrings(item, `${path}[${index}]`, visit));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      walkStrings(child, path ? `${path}.${key}` : key, visit);
    }
  }
}

function scanText(path, text, findings) {
  if (!text) return;
  for (const pattern of PATTERNS) {
    pattern.regex.lastIndex = 0;
    let match;
    while ((match = pattern.regex.exec(text))) {
      findings.push({
        type: "secret_in_description",
        pattern: pattern.id,
        label: pattern.label,
        severity: pattern.severity,
        path,
        redacted: redact(match[0]),
        reason: `${pattern.label} found in ${path}`,
      });
    }
  }
}

function scanToolSecrets(tools) {
  const findings = [];
  (tools || []).forEach((tool, index) => {
    const base = `tools[${index}]${tool?.name ? `(${tool.name})` : ""}`;
    scanText(`${base}.name`, tool?.name, findings);
    scanText(`${base}.description`, tool?.description, findings);
    walkStrings(tool?.inputSchema ?? tool?.input_schema ?? {}, `${base}.inputSchema`, (path, text) => {
      scanText(path, text, findings);
    });
    if (tool?.title) scanText(`${base}.title`, tool.title, findings);
  });
  return findings;
}

module.exports = { PATTERNS, scanToolSecrets, redact };
