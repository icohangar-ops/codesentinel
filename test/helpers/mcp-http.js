const http = require("node:http");

function listen(handler) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        server,
        port,
        url: `http://127.0.0.1:${port}/mcp`,
        origin: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise((done, fail) => {
            server.close((err) => (err ? fail(err) : done()));
          }),
      });
    });
    server.on("error", reject);
  });
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

function initializeResult() {
  return {
    protocolVersion: "2025-03-26",
    capabilities: { tools: {} },
    serverInfo: { name: "fixture-mcp", version: "0.0.1" },
  };
}

function handleInitialized(res) {
  res.writeHead(202);
  res.end();
}

function acceptOk(req) {
  const accept = String(req.headers.accept || "");
  return accept.includes("application/json") && accept.includes("text/event-stream");
}

function acceptEventStream(req) {
  return String(req.headers.accept || "").includes("text/event-stream");
}

/**
 * FastMCP Streamable HTTP-shaped fixture: Accept enforcement, session header,
 * GET-as-SSE-only, and unknown-session rejection.
 */
function createFastMcpLikeHandler(options = {}) {
  const sessions = new Set();
  const tools = options.tools || [
    { name: "ping", description: "Returns pong", inputSchema: { type: "object", properties: {} } },
  ];
  const silentMode = options.silentMode || "error"; // error | empty | success | malformed

  return async (req, res) => {
    const session = req.headers["mcp-session-id"];

    if (req.method === "GET") {
      if (!acceptEventStream(req)) {
        sendJson(res, 406, {
          jsonrpc: "2.0",
          id: "server-error",
          error: { code: -32600, message: "Not Acceptable: Client must accept text/event-stream" },
        });
        return;
      }
      if (session && !sessions.has(session)) {
        sendJson(res, 404, {
          jsonrpc: "2.0",
          id: "server-error",
          error: { code: -32000, message: "Bad Request: No valid session ID provided" },
        });
        return;
      }
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end();
      return;
    }

    if (req.method !== "POST") {
      res.writeHead(405, { allow: "GET, POST" });
      res.end();
      return;
    }

    if (!acceptOk(req)) {
      sendJson(res, 406, {
        jsonrpc: "2.0",
        id: "server-error",
        error: { code: -32600, message: "Not Acceptable: Client must accept text/event-stream" },
      });
      return;
    }

    const body = await readJson(req);

    if (body.method === "initialize") {
      const sid = `sess-${Math.random().toString(16).slice(2)}`;
      sessions.add(sid);
      sendJson(res, 200, { jsonrpc: "2.0", id: body.id, result: initializeResult() }, { "mcp-session-id": sid });
      return;
    }

    if (!session) {
      sendJson(res, 400, {
        jsonrpc: "2.0",
        id: "server-error",
        error: { code: -32600, message: "Bad Request: Missing session ID" },
      });
      return;
    }
    if (!sessions.has(session)) {
      sendJson(res, 400, {
        jsonrpc: "2.0",
        id: "server-error",
        error: { code: -32600, message: "Bad Request: No valid session ID provided" },
      });
      return;
    }

    if (body.method === "notifications/initialized") {
      handleInitialized(res);
      return;
    }
    if (body.method === "tools/list") {
      sendJson(res, 200, { jsonrpc: "2.0", id: body.id, result: { tools } }, { "mcp-session-id": session });
      return;
    }
    if (body.method === "tools/call") {
      if (silentMode === "empty") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end();
        return;
      }
      if (silentMode === "success") {
        sendJson(res, 200, {
          jsonrpc: "2.0",
          id: body.id,
          result: { content: [{ type: "text", text: "ok" }] },
        });
        return;
      }
      if (silentMode === "malformed") {
        sendJson(res, 200, { jsonrpc: "2.0", id: body.id, error: { message: "" } });
        return;
      }
      sendJson(res, 200, {
        jsonrpc: "2.0",
        id: body.id,
        error: { code: -32602, message: `Unknown tool: ${body.params?.name || "?"}` },
      });
      return;
    }

    sendJson(res, 200, { jsonrpc: "2.0", id: body.id, error: { code: -32601, message: "Method not found" } });
  };
}

module.exports = {
  listen,
  readJson,
  sendJson,
  initializeResult,
  handleInitialized,
  createFastMcpLikeHandler,
};
