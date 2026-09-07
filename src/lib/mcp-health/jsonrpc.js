/**
 * JSON-RPC + SSE helpers for MCP handshake health checks.
 * Streamable HTTP may return application/json or text/event-stream.
 */

function looksLikeJson(text) {
  const trimmed = String(text || "").trim();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

function looksLikeSse(text) {
  const trimmed = String(text || "").trim();
  return (
    trimmed.startsWith("event:") ||
    trimmed.startsWith("data:") ||
    trimmed.startsWith("id:") ||
    trimmed.includes("\nevent:") ||
    trimmed.includes("\ndata:")
  );
}

function parseSseEvents(text) {
  const normalized = String(text || "").replace(/\r\n/g, "\n");
  const events = [];
  for (const block of normalized.split("\n\n")) {
    if (!block.trim()) continue;
    let event = "message";
    const dataLines = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
    }
    events.push({ event, data: dataLines.join("\n") });
  }
  return events;
}

function parseJsonSafe(text) {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

function collectJsonRpcMessages(text, contentType = "") {
  const type = String(contentType || "").toLowerCase();
  const raw = String(text || "");
  const messages = [];
  const sseEvents = [];

  if (!raw.trim()) {
    return { kind: "empty", messages, sseEvents, raw };
  }

  if (type.includes("text/event-stream") || looksLikeSse(raw)) {
    for (const evt of parseSseEvents(raw)) {
      sseEvents.push(evt);
      if (!evt.data) continue;
      const parsed = parseJsonSafe(evt.data);
      if (parsed.ok) {
        const value = parsed.value;
        if (Array.isArray(value)) messages.push(...value);
        else messages.push(value);
      }
    }
    return { kind: "sse", messages, sseEvents, raw };
  }

  if (type.includes("application/json") || looksLikeJson(raw)) {
    const parsed = parseJsonSafe(raw.trim());
    if (!parsed.ok) {
      return { kind: "invalid-json", messages, sseEvents, raw, error: parsed.error };
    }
    if (Array.isArray(parsed.value)) messages.push(...parsed.value);
    else messages.push(parsed.value);
    return { kind: "json", messages, sseEvents, raw };
  }

  return { kind: "non-json", messages, sseEvents, raw };
}

function findJsonRpcById(messages, id) {
  return (messages || []).find((msg) => msg && typeof msg === "object" && msg.id === id) || null;
}

function findSseEndpoint(sseEvents) {
  const match = (sseEvents || []).find((evt) => evt.event === "endpoint" && evt.data);
  return match ? match.data.trim() : null;
}

module.exports = {
  looksLikeJson,
  looksLikeSse,
  parseSseEvents,
  collectJsonRpcMessages,
  findJsonRpcById,
  findSseEndpoint,
};
