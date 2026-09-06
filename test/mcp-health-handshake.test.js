const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { checkMcpHealth } = require("../src/lib/mcp-health");
const { listen, readJson, sendJson, initializeResult, handleInitialized } = require("./helpers/mcp-http");

const SAMPLE_TOOLS = [
  {
    name: "ping",
    description: "Returns pong",
    inputSchema: { type: "object", properties: {} },
  },
];

describe("MCP handshake health", () => {
  it("treats HTTP 200 HTML as protocol failure", async () => {
    const fixture = await listen((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<!doctype html><html><body>OK</body></html>");
    });

    try {
      const result = await checkMcpHealth(fixture.url, { timeoutMs: 2000 });
      assert.equal(result.http.status, 200);
      assert.equal(result.httpUp, true);
      assert.equal(result.protocolHealthy, false);
      assert.equal(result.ok, false);
      assert.equal(result.alarms.some((a) => a.type === "handshake_failed"), true);
      assert.match(result.protocol.initialize.error, /non-JSON|HTML|body/i);
      assert.equal(typeof result.latency.initializeMs, "number");
      assert.equal(typeof result.latency.toolsListMs, "number");
      assert.equal(typeof result.latency.handshakeMs, "number");
    } finally {
      await fixture.close();
    }
  });

  it("treats HTTP 200 JSON-RPC initialize error as protocol failure", async () => {
    const fixture = await listen(async (req, res) => {
      const body = await readJson(req);
      sendJson(res, 200, {
        jsonrpc: "2.0",
        id: body.id,
        error: { code: -32603, message: "upstream initialize exploded" },
      });
    });

    try {
      const result = await checkMcpHealth(fixture.url, { timeoutMs: 2000, transport: "streamable-http" });
      assert.equal(result.http.status, 200);
      assert.equal(result.httpUp, true);
      assert.equal(result.protocolHealthy, false);
      assert.match(result.protocol.initialize.error, /upstream initialize exploded/);
    } finally {
      await fixture.close();
    }
  });

  it("fails when initialize succeeds but tools/list SSE is not JSON-RPC", async () => {
    const fixture = await listen(async (req, res) => {
      if (req.method !== "POST") {
        res.writeHead(405);
        res.end();
        return;
      }
      const body = await readJson(req);
      if (body.method === "initialize") {
        sendJson(res, 200, { jsonrpc: "2.0", id: body.id, result: initializeResult() }, { "mcp-session-id": "sess-1" });
        return;
      }
      if (body.method === "notifications/initialized") {
        handleInitialized(res);
        return;
      }
      if (body.method === "tools/list") {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.end("event: message\ndata: not-json-rpc\n\n");
        return;
      }
      res.writeHead(404);
      res.end();
    });

    try {
      const result = await checkMcpHealth(fixture.url, { timeoutMs: 2000, transport: "streamable-http" });
      assert.equal(result.http.status, 200);
      assert.equal(result.httpUp, true);
      assert.equal(result.protocol.initialize.ok, true);
      assert.equal(result.protocol.toolsList.ok, false);
      assert.equal(result.protocolHealthy, false);
      assert.equal(result.alarms.some((a) => a.type === "handshake_failed" && a.step === "tools/list"), true);
    } finally {
      await fixture.close();
    }
  });

  it("passes Streamable HTTP initialize + tools/list and records latency", async () => {
    const fixture = await listen(async (req, res) => {
      const body = req.method === "POST" ? await readJson(req) : {};
      if (body.method === "initialize") {
        sendJson(res, 200, { jsonrpc: "2.0", id: body.id, result: initializeResult() }, { "mcp-session-id": "sess-ok" });
        return;
      }
      if (body.method === "notifications/initialized") {
        handleInitialized(res);
        return;
      }
      if (body.method === "tools/list") {
        sendJson(res, 200, { jsonrpc: "2.0", id: body.id, result: { tools: SAMPLE_TOOLS } }, { "mcp-session-id": "sess-ok" });
        return;
      }
      res.writeHead(404);
      res.end();
    });

    try {
      const result = await checkMcpHealth(fixture.url, { timeoutMs: 2000 });
      assert.equal(result.protocolHealthy, true);
      assert.equal(result.ok, true);
      assert.equal(result.httpUp, true);
      assert.equal(result.transport, "streamable-http");
      assert.equal(result.schema.toolCount, 1);
      assert.equal(result.schema.hash.length, 64);
      assert.equal(result.tools[0].name, "ping");
      assert.ok(result.latency.handshakeMs >= 0);
      assert.ok(result.latency.initializeMs >= 0);
      assert.ok(result.latency.toolsListMs >= 0);
    } finally {
      await fixture.close();
    }
  });

  it("completes a legacy HTTP+SSE handshake via the endpoint event", async () => {
    const fixture = await listen(async (req, res) => {
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (req.method === "GET" && url.pathname === "/mcp") {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.end("event: endpoint\ndata: /messages?session=legacy\n\n");
        return;
      }
      if (req.method === "POST" && url.pathname === "/messages") {
        const body = await readJson(req);
        if (body.method === "initialize") {
          sendJson(res, 200, { jsonrpc: "2.0", id: body.id, result: initializeResult() });
          return;
        }
        if (body.method === "notifications/initialized") {
          handleInitialized(res);
          return;
        }
        if (body.method === "tools/list") {
          sendJson(res, 200, { jsonrpc: "2.0", id: body.id, result: { tools: SAMPLE_TOOLS } });
          return;
        }
      }
      res.writeHead(404);
      res.end();
    });

    try {
      const result = await checkMcpHealth(fixture.url, { timeoutMs: 2000, transport: "sse" });
      assert.equal(result.protocolHealthy, true);
      assert.equal(result.transport, "sse");
      assert.equal(result.schema.toolCount, 1);
    } finally {
      await fixture.close();
    }
  });

  it("accepts tools/list delivered as SSE events after initialize", async () => {
    const fixture = await listen(async (req, res) => {
      const body = req.method === "POST" ? await readJson(req) : {};
      if (body.method === "initialize") {
        sendJson(res, 200, { jsonrpc: "2.0", id: body.id, result: initializeResult() });
        return;
      }
      if (body.method === "notifications/initialized") {
        handleInitialized(res);
        return;
      }
      if (body.method === "tools/list") {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { tools: SAMPLE_TOOLS } })}\n\n`);
        return;
      }
      res.writeHead(404);
      res.end();
    });

    try {
      const result = await checkMcpHealth(fixture.url, { timeoutMs: 2000, transport: "streamable-http" });
      assert.equal(result.protocolHealthy, true);
      assert.equal(result.schema.toolCount, 1);
    } finally {
      await fixture.close();
    }
  });
});
