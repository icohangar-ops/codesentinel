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

module.exports = {
  listen,
  readJson,
  sendJson,
  initializeResult,
  handleInitialized,
};
