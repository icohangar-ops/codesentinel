/**
 * Web-standard Streamable HTTP handler (Request → Response).
 *
 * Used by the Node listen entry (http.js) and the Vercel Fluid Compute
 * function (api/index.mjs). Stateless: no Mcp-Session-Id, new server+transport
 * per POST so any instance can serve any request.
 */

const { requireConfiguredToken, parseBearerToken, tokensEqual } = require("./auth");
const { SERVER_INFO } = require("./server-info");

// Load the ESM MCP SDK via import() and defer create-server (octokit / tools)
// until after /health and Bearer checks. Top-level require() of that graph is
// what crashed Vercel with ERR_REQUIRE_ESM before the handler could run.
async function loadMcpRuntime() {
  const [{ WebStandardStreamableHTTPServerTransport }, { createMcpServer }] = await Promise.all([
    import("@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"),
    import("./create-server.js"),
  ]);
  return { WebStandardStreamableHTTPServerTransport, createMcpServer };
}

const DEFAULT_PATH = "/mcp";

function parseList(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
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

function healthPayload() {
  return {
    ok: true,
    name: SERVER_INFO.name,
    version: SERVER_INFO.version,
    transport: "streamable-http",
    mode: "stateless",
  };
}

function resolveCorsOrigin(request, origins) {
  const requestOrigin = request.headers.get("origin");
  const list = origins === "*" || !origins || (Array.isArray(origins) && origins.length === 0) ? ["*"] : origins;
  if (list.includes("*")) return requestOrigin || "*";
  if (requestOrigin && list.includes(requestOrigin)) return requestOrigin;
  return null;
}

function withCors(response, request, origins) {
  const headers = new Headers(response.headers);
  const allowOrigin = resolveCorsOrigin(request, origins);
  if (allowOrigin) {
    headers.set("Access-Control-Allow-Origin", allowOrigin);
    headers.set("Vary", "Origin");
  }
  headers.set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  headers.set(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type, Accept, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID"
  );
  headers.set("Access-Control-Expose-Headers", "Mcp-Session-Id, MCP-Protocol-Version");
  headers.set("Access-Control-Max-Age", "86400");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function jsonRpc(status, error, extraHeaders = {}) {
  return new Response(JSON.stringify({ jsonrpc: "2.0", error, id: null }), {
    status,
    headers: { "content-type": "application/json", ...extraHeaders },
  });
}

async function handleWebRequest(request, options = {}) {
  const env = options.env || process.env;
  const mcpPath = resolvePath(env, options.path);
  const corsOrigins = options.corsOrigins ?? parseList(env.MCP_HTTP_CORS_ORIGINS);
  const originSetting = corsOrigins.length === 0 ? "*" : corsOrigins;
  const url = new URL(request.url);
  const pathname = url.pathname.replace(/\/$/, "") || "/";

  const respond = (response) => withCors(response, request, originSetting);

  if (request.method === "OPTIONS") {
    return respond(new Response(null, { status: 204 }));
  }

  if (pathname === "/health" || pathname === "/healthz") {
    return respond(Response.json(healthPayload()));
  }

  if (pathname !== mcpPath) {
    return respond(Response.json({ error: "Not found" }, { status: 404 }));
  }

  let expectedToken;
  try {
    expectedToken = options.bearerToken != null ? options.bearerToken : requireConfiguredToken(env);
  } catch {
    return respond(
      jsonRpc(401, { code: -32001, message: "Unauthorized" }, {
        "WWW-Authenticate": 'Bearer realm="CodeSentinel MCP", error="invalid_token"',
      })
    );
  }

  const provided = parseBearerToken(request.headers.get("authorization"));
  if (!provided || !tokensEqual(expectedToken, provided)) {
    return respond(
      jsonRpc(401, { code: -32001, message: "Unauthorized" }, {
        "WWW-Authenticate": 'Bearer realm="CodeSentinel MCP", error="invalid_token"',
      })
    );
  }

  if (request.method === "GET" || request.method === "DELETE") {
    return respond(jsonRpc(405, { code: -32000, message: "Method not allowed." }));
  }
  if (request.method !== "POST") {
    return respond(jsonRpc(405, { code: -32000, message: "Method not allowed." }));
  }

  const enableJsonResponse = jsonResponseEnabled(env, options.jsonResponse);
  const { WebStandardStreamableHTTPServerTransport, createMcpServer } = await loadMcpRuntime();
  const server = createMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse,
  });
  await server.connect(transport);
  try {
    const mcpResponse = await transport.handleRequest(request);
    const teardown = () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    };
    if (enableJsonResponse || !mcpResponse.body) {
      const body = mcpResponse.body ? await mcpResponse.arrayBuffer() : null;
      teardown();
      return respond(
        new Response(body, {
          status: mcpResponse.status,
          statusText: mcpResponse.statusText,
          headers: mcpResponse.headers,
        })
      );
    }
    const { readable, writable } = new TransformStream();
    mcpResponse.body.pipeTo(writable).finally(teardown);
    return respond(
      new Response(readable, {
        status: mcpResponse.status,
        statusText: mcpResponse.statusText,
        headers: mcpResponse.headers,
      })
    );
  } catch (error) {
    console.error("Error handling MCP request:", error instanceof Error ? error.message : "unknown");
    await transport.close().catch(() => {});
    await server.close().catch(() => {});
    return respond(jsonRpc(500, { code: -32603, message: "Internal server error" }));
  }
}

module.exports = {
  DEFAULT_PATH,
  handleWebRequest,
  healthPayload,
  resolvePath,
  jsonResponseEnabled,
};
