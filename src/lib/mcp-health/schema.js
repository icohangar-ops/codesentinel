/**
 * Canonical tool-schema hashing and drift comparison.
 * Hash is order-independent (tools sorted by name, object keys sorted).
 */

const crypto = require("node:crypto");

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])])
    );
  }
  return value;
}

function normalizeTool(tool = {}) {
  return {
    name: tool.name ?? "",
    description: tool.description ?? "",
    inputSchema: tool.inputSchema ?? tool.input_schema ?? {},
  };
}

function canonicalTools(tools) {
  const normalized = (tools || []).map(normalizeTool);
  normalized.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return canonicalize(normalized);
}

function hashToolSchemas(tools) {
  const payload = JSON.stringify(canonicalTools(tools));
  return crypto.createHash("sha256").update(payload, "utf8").digest("hex");
}

function toolHash(tool) {
  return hashToolSchemas([normalizeTool(tool)]);
}

function indexByName(tools) {
  const map = new Map();
  for (const tool of tools || []) {
    if (tool && tool.name) map.set(tool.name, normalizeTool(tool));
  }
  return map;
}

/**
 * Compare two tools/list snapshots.
 * `previous` may be an array of tools, a hash string, or { tools, hash }.
 */
function compareToolSchemas(previous, currentTools) {
  const current = currentTools || [];
  const currentHash = hashToolSchemas(current);

  let previousTools = [];
  let previousHash = null;

  if (typeof previous === "string") {
    previousHash = previous;
  } else if (Array.isArray(previous)) {
    previousTools = previous;
    previousHash = hashToolSchemas(previousTools);
  } else if (previous && typeof previous === "object") {
    previousTools = previous.tools || [];
    previousHash = previous.hash || (previousTools.length ? hashToolSchemas(previousTools) : null);
  }

  const added = [];
  const removed = [];
  const modified = [];

  if (previousTools.length || current.length) {
    const prevMap = indexByName(previousTools);
    const currMap = indexByName(current);

    for (const [name, tool] of currMap) {
      if (!prevMap.has(name)) added.push(name);
      else if (toolHash(tool) !== toolHash(prevMap.get(name))) modified.push(name);
    }
    for (const name of prevMap.keys()) {
      if (!currMap.has(name)) removed.push(name);
    }
  }

  const hashChanged = previousHash != null && previousHash !== currentHash;
  const changed = hashChanged || added.length > 0 || removed.length > 0 || modified.length > 0;

  return {
    changed,
    hashChanged,
    previousHash,
    currentHash,
    added,
    removed,
    modified,
    currentCount: current.length,
    previousCount: previousTools.length,
  };
}

module.exports = {
  canonicalize,
  normalizeTool,
  canonicalTools,
  hashToolSchemas,
  compareToolSchemas,
};
