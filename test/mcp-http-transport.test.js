const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const { checkMcpHealth } = require("../src/lib/mcp-health");
const { EXPECTED_TOOL_NAMES } = require("../mcp-server/create-server");
const { requireConfiguredToken, tokensEqual } = require("../mcp-server/auth");
const { startHttpServer } = require("../mcp-server/http");
const { handleWebRequest } = require("../mcp-server/web-handler");

const TOKEN = "test-bearer-token-ok";
const SECRET = "sk-test-should-never-appear-in-http-bodies";

function authHeaders(token = TOKEN) {
  return { Authorization: `Bearer ${token}` };
}

async function postMcp(url, message, headers = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
      "MCP-Protocol-Version": "2025-03-26",
      ...headers,
    },
    body: JSON.stringify(message),
  });
  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { response, text, json };
}

describe("HTTP Bearer auth helpers", () => {
  it("refuses to start HTTP mode without MCP_BEARER_TOKEN", () => {
    assert.throws(() => requireConfiguredToken({}), /MCP_BEARER_TOKEN/);
    assert.throws(() => requireConfiguredToken({ MCP_BEARER_TOKEN: "   " }), /MCP_BEARER_TOKEN/);
  });

  it("rejects short tokens in production", () => {
    assert.throws(
      () => requireConfiguredToken({ NODE_ENV: "production", MCP_BEARER_TOKEN: "short" }),
      /16 characters/
    );
  });

  it("compares tokens in a length-safe way", () => {
    assert.equal(tokensEqual("abc", "abc"), true);
    assert.equal(tokensEqual("abc", "abd"), false);
    assert.equal(tokensEqual("abc", "ab"), false);
    assert.equal(tokensEqual("", "x"), false);
  });
});

describe("Streamable HTTP MCP server", () => {
  let listening;

  before(async () => {
    process.env.LLM_API_KEY = SECRET;
    listening = await startHttpServer({
      host: "127.0.0.1",
      port: 0,
      bearerToken: TOKEN,
      jsonResponse: true,
    });
  });

  after(async () => {
    if (listening) await listening.close();
  });

  it("serves /health without auth and without secrets", async () => {
    const response = await fetch(`http://127.0.0.1:${listening.port}/health`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.transport, "streamable-http");
    assert.equal(body.mode, "stateless");
    assert.equal(body.name, "CodeSentinel");
    assert.doesNotMatch(JSON.stringify(body), new RegExp(SECRET));
    assert.doesNotMatch(JSON.stringify(body), new RegExp(TOKEN));
  });

  it("returns 401 when Authorization is missing", async () => {
    const { response, json, text } = await postMcp(listening.url, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "0" } },
    });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("www-authenticate")?.startsWith("Bearer"), true);
    assert.equal(json?.error?.message, "Unauthorized");
    assert.doesNotMatch(text, /analyze_dead_code/);
    assert.doesNotMatch(text, new RegExp(SECRET));
  });

  it("returns 401 when the Bearer token is invalid", async () => {
    const { response, text } = await postMcp(
      listening.url,
      { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
      authHeaders("wrong-token-value")
    );
    assert.equal(response.status, 401);
    assert.doesNotMatch(text, /analyze_dead_code/);
  });

  it("completes an authenticated Streamable HTTP handshake", async () => {
    const result = await checkMcpHealth(listening.url, {
      timeoutMs: 4000,
      transport: "streamable-http",
      headers: authHeaders(),
    });
    assert.equal(result.httpUp, true);
    assert.equal(result.protocolHealthy, true);
    assert.equal(result.ok, true);
    assert.equal(result.transport, "streamable-http");
    const names = result.tools.map((tool) => tool.name).sort();
    assert.deepEqual(names, [...EXPECTED_TOOL_NAMES].sort());
    assert.doesNotMatch(JSON.stringify(result), new RegExp(SECRET));
    assert.doesNotMatch(JSON.stringify(result), new RegExp(TOKEN));
  });

  it("does not echo LLM_API_KEY from an authenticated tool call", async () => {
    await postMcp(
      listening.url,
      {
        jsonrpc: "2.0",
        id: 10,
        method: "initialize",
        params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "0" } },
      },
      authHeaders()
    );
    await postMcp(listening.url, { jsonrpc: "2.0", method: "notifications/initialized" }, authHeaders());
    const { response, text } = await postMcp(
      listening.url,
      {
        jsonrpc: "2.0",
        id: 11,
        method: "tools/call",
        params: {
          name: "explain_finding",
          arguments: {
            finding_type: "dead_code",
            finding_description: "unused helper",
          },
        },
      },
      authHeaders()
    );
    assert.equal(response.ok, true);
    assert.doesNotMatch(text, new RegExp(SECRET));
    assert.match(text, /dead_code|maintenance burden/i);
  });
});

describe("Web-standard handler (Vercel Fluid Compute shape)", () => {
  it("serves health and rejects unauthenticated initialize without Node listen", async () => {
    const health = await handleWebRequest(new Request("http://127.0.0.1/health"), {
      bearerToken: TOKEN,
    });
    assert.equal(health.status, 200);
    const healthBody = await health.json();
    assert.equal(healthBody.transport, "streamable-http");
    assert.equal(healthBody.mode, "stateless");

    const unauth = await handleWebRequest(
      new Request("http://127.0.0.1/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "0" } },
        }),
      }),
      { bearerToken: TOKEN }
    );
    assert.equal(unauth.status, 401);

    const init = await handleWebRequest(
      new Request("http://127.0.0.1/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${TOKEN}`,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "t", version: "0" } },
        }),
      }),
      { bearerToken: TOKEN, jsonResponse: true }
    );
    assert.equal(init.status, 200);
    const initBody = await init.json();
    assert.equal(initBody.result.serverInfo.name, "CodeSentinel");
  });
});

describe("stdio MCP entrypoint", () => {
  it("still answers initialize on stdin without HTTP auth", async () => {
    const child = spawn(process.execPath, [path.join(__dirname, "../mcp-server/index.js")], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, MCP_BEARER_TOKEN: "" },
    });

    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));

    const initialize = {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "stdio-smoke", version: "0" },
      },
    };
    child.stdin.write(`${JSON.stringify(initialize)}\n`);

    const message = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`stdio initialize timed out: ${Buffer.concat(stderr)}`)), 4000);
      const tryParse = () => {
        const text = Buffer.concat(stdout).toString("utf8");
        const line = text.split("\n").find((row) => row.trim().startsWith("{"));
        if (!line) return;
        try {
          const parsed = JSON.parse(line);
          if (parsed.id === 1) {
            clearTimeout(timer);
            resolve(parsed);
          }
        } catch {
          // wait for a complete line
        }
      };
      child.stdout.on("data", tryParse);
    });

    child.kill("SIGTERM");
    assert.equal(message.error, undefined);
    assert.equal(message.result.serverInfo.name, "CodeSentinel");
    assert.match(Buffer.concat(stderr).toString("utf8"), /running on stdio/);
  });
});
