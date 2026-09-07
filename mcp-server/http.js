#!/usr/bin/env node

/**
 * CodeSentinel MCP — Streamable HTTP (stateless)
 *
 * Same tools as stdio. Public HTTPS + streamable-http is what Glama remote
 * connectors require. Bind host/port come from env; this file never invents
 * a public hostname.
 */

try {
  require("dotenv").config();
} catch {
  // dotenv is optional when the process already has env (containers / tests).
}

const { StreamableHTTPServerTransport } = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const { createMcpExpressApp } = require("@modelcontextprotocol/sdk/server/express.js");
const { createMcpServer, SERVER_INFO } = require("./create-server");
const { bearerAuth, requireConfiguredToken } = require("./auth");

const DEFAULT_PORT = 8787;
const DEFAULT_PATH = "/mcp";

function parseList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function resolveHost(env = process.env, explicit) {
  if (explicit) return explicit;
  if (env.MCP_HTTP_HOST) return env.MCP_HTTP_HOST;
  if (env.HOST) return env.HOST;
  // Platform injects PORT (Fly/Railway). Bind all interfaces there.
  if (env.PORT) return "0.0.0.0";
  return "127.0.0.1";
}

function resolvePort(env = process.env, explicit) {
  if (explicit != null && explicit !== "") return Number(explicit);
  if (env.MCP_HTTP_PORT) return Number(env.MCP_HTTP_PORT);
  if (env.PORT) return Number(env.PORT);
  return DEFAULT_PORT;
}

function resolvePath(env = process.env, explicit) {
  const path = explicit || env.MCP_HTTP_PATH || DEFAULT_PATH;
  return path.startsWith("/") ? path : `/${path}`;
}

function jsonResponseEnabled(env = process.env, explicit) {
  if (typeof explicit === "boolean") return explicit;
  const raw = env.MCP_HTTP_JSON_RESPONSE;
  if (raw == null || raw === "") return true;
  return !["0", "false", "off", "no"].includes(String(raw).toLowerCase());
}

function applyCors(req, res, origins) {
  const requestOrigin = req.headers.origin;
  let allowOrigin = null;
  if (origins === "*" || (Array.isArray(origins) && origins.includes("*"))) {
    allowOrigin = requestOrigin || "*";
  } else if (requestOrigin && Array.isArray(origins) && origins.includes(requestOrigin)) {
    allowOrigin = requestOrigin;
  } else if (typeof origins === "string" && origins && origins !== "*" && origins === requestOrigin) {
    allowOrigin = requestOrigin;
  }

  if (allowOrigin) {
    res.setHeader("Access-Control-Allow-Origin", allowOrigin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type, Accept, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID"
  );
  res.setHeader("Access-Control-Expose-Headers", "Mcp-Session-Id, MCP-Protocol-Version");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function corsMiddleware(origins) {
  return function handleCors(req, res, next) {
    applyCors(req, res, origins);
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  };
}

function healthPayload() {
  return {
    ok: true,
    name: SERVER_INFO.name,
    version: SERVER_INFO.version,
    transport: "streamable-http",
    mode: "stateless",
  };
}

function methodNotAllowed(res) {
  res.status(405).json({
    jsonrpc: "2.0",
    error: { code: -32000, message: "Method not allowed." },
    id: null,
  });
}

function createHttpApp(options = {}) {
  const env = options.env || process.env;
  const bearerToken = options.bearerToken != null ? options.bearerToken : requireConfiguredToken(env);
  const host = resolveHost(env, options.host);
  const mcpPath = resolvePath(env, options.path);
  const enableJsonResponse = jsonResponseEnabled(env, options.jsonResponse);
  const allowedHosts = parseList(options.allowedHosts ?? env.MCP_ALLOWED_HOSTS);
  const corsOrigins = options.corsOrigins ?? parseList(env.MCP_HTTP_CORS_ORIGINS);
  const originSetting = corsOrigins.length === 0 ? "*" : corsOrigins;

  const app = createMcpExpressApp({
    host,
    allowedHosts: allowedHosts.length ? allowedHosts : undefined,
  });

  app.use(corsMiddleware(originSetting));

  const writeHealth = (_req, res) => {
    res.status(200).json(healthPayload());
  };
  app.get("/health", writeHealth);
  app.get("/healthz", writeHealth);

  app.use(mcpPath, bearerAuth(bearerToken));

  app.post(mcpPath, async (req, res) => {
    const server = createMcpServer();
    try {
      // Stateless: no session id, no in-memory session map. Each POST is
      // independent so any replica can serve initialize / tools/list / tools/call.
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse,
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
      res.on("close", () => {
        transport.close().catch(() => {});
        server.close().catch(() => {});
      });
    } catch (error) {
      console.error("Error handling MCP request:", error instanceof Error ? error.message : "unknown");
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
      server.close().catch(() => {});
    }
  });

  app.get(mcpPath, (_req, res) => methodNotAllowed(res));
  app.delete(mcpPath, (_req, res) => methodNotAllowed(res));

  return app;
}

function startHttpServer(options = {}) {
  const env = options.env || process.env;
  const app = options.app || createHttpApp(options);
  const host = resolveHost(env, options.host);
  const port = resolvePort(env, options.port);
  const mcpPath = resolvePath(env, options.path);

  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => {
      const address = server.address();
      const boundPort = typeof address === "object" && address ? address.port : port;
      const boundHost = typeof address === "object" && address ? address.address : host;
      resolve({
        app,
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
