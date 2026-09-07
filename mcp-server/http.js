#!/usr/bin/env node

/**
 * CodeSentinel MCP — Streamable HTTP (stateless)
 *
 * Same tools as stdio. Public HTTPS + streamable-http is what Glama remote
 * connectors require. Bind host/port come from env; this file never invents
 * a public hostname.
 *
 * Local / Docker / Fly use this Node listen process. Vercel uses the same
 * handleWebRequest via api/index.mjs (Fluid Compute).
 */

try {
  require("dotenv").config();
} catch {
  // dotenv is optional when the process already has env (containers / tests).
}

const http = require("node:http");
const { requireConfiguredToken } = require("./auth");
const { handleWebRequest, healthPayload, resolvePath } = require("./web-handler");

const DEFAULT_PORT = 8787;
const DEFAULT_PATH = "/mcp";

function resolveHost(env = process.env, explicit) {
  if (explicit) return explicit;
  if (env.MCP_HTTP_HOST) return env.MCP_HTTP_HOST;
  if (env.HOST) return env.HOST;
  if (env.PORT) return "0.0.0.0";
  return "127.0.0.1";
}

function resolvePort(env = process.env, explicit) {
  if (explicit != null && explicit !== "") return Number(explicit);
  if (env.MCP_HTTP_PORT) return Number(env.MCP_HTTP_PORT);
  if (env.PORT) return Number(env.PORT);
  return DEFAULT_PORT;
}

function incomingToRequest(req) {
  const protoHeader = req.headers["x-forwarded-proto"];
  const proto = (Array.isArray(protoHeader) ? protoHeader[0] : protoHeader) || "http";
  const host = req.headers.host || "127.0.0.1";
  const url = `${proto}://${host}${req.url}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value == null) continue;
    headers.set(key, Array.isArray(value) ? value.join(", ") : String(value));
  }
  const method = req.method || "GET";
  const init = { method, headers };
  if (method !== "GET" && method !== "HEAD") {
    init.body = req;
    init.duplex = "half";
  }
  return new Request(url, init);
}

async function sendNodeResponse(res, webResponse) {
  res.statusCode = webResponse.status;
  webResponse.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });
  if (!webResponse.body) {
    res.end();
    return;
  }
  const reader = webResponse.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
  } finally {
    res.end();
  }
}

function createRequestListener(options = {}) {
  return async function requestListener(req, res) {
    try {
      const request = incomingToRequest(req);
      const response = await handleWebRequest(request, options);
      await sendNodeResponse(res, response);
    } catch (error) {
      console.error("Error handling HTTP request:", error instanceof Error ? error.message : "unknown");
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32603, message: "Internal server error" },
            id: null,
          })
        );
      }
    }
  };
}

function createHttpApp(options = {}) {
  const listener = createRequestListener(options);
  return {
    listen(port, host, callback) {
      const server = http.createServer(listener);
      if (typeof host === "function") {
        callback = host;
        host = undefined;
      }
      if (host) server.listen(port, host, callback);
      else server.listen(port, callback);
      return server;
    },
  };
}

function startHttpServer(options = {}) {
  const env = options.env || process.env;
  if (options.bearerToken == null) {
    requireConfiguredToken(env);
  }
  const host = resolveHost(env, options.host);
  const port = resolvePort(env, options.port);
  const mcpPath = resolvePath(env, options.path);
  const listener = createRequestListener(options);

  return new Promise((resolve, reject) => {
    const server = http.createServer(listener);
    server.listen(port, host, () => {
      const address = server.address();
      const boundPort = typeof address === "object" && address ? address.port : port;
      const boundHost = typeof address === "object" && address ? address.address : host;
      resolve({
        server,
        host: boundHost,
        port: boundPort,
        path: mcpPath,
        url: `http://127.0.0.1:${boundPort}${mcpPath}`,
        close: () =>
          new Promise((done, fail) => {
            server.close((err) => (err ? fail(err) : done()));
          }),
      });
    });
    server.on("error", reject);
  });
}

async function main() {
  requireConfiguredToken(process.env);
  const listening = await startHttpServer();
  console.error(
    `🔧 CodeSentinel MCP Server running on Streamable HTTP (stateless) at http://${listening.host}:${listening.port}${listening.path}`
  );
  console.error("   Auth: Authorization: Bearer <MCP_BEARER_TOKEN>");
  console.error("   Health: GET /health (no tools, no secrets)");
}

module.exports = {
  DEFAULT_PORT,
  DEFAULT_PATH,
  createHttpApp,
  createRequestListener,
  startHttpServer,
  resolveHost,
  resolvePort,
  resolvePath,
  healthPayload,
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
