/**
 * Fail-closed Bearer auth for the public Streamable HTTP MCP endpoint.
 * Tokens are compared in constant time. Responses never echo credentials.
 */

const { timingSafeEqual } = require("node:crypto");

const MIN_PRODUCTION_TOKEN_LENGTH = 16;

function configuredBearerToken(env = process.env) {
  const raw = env.MCP_BEARER_TOKEN;
  if (raw == null) return "";
  return String(raw).trim();
}

function requireConfiguredToken(env = process.env) {
  const token = configuredBearerToken(env);
  if (!token) {
    throw new Error(
      "MCP_BEARER_TOKEN is required to start the HTTP MCP server (fail-closed). Set a secret Bearer token before binding a public port."
    );
  }
  if ((env.NODE_ENV || "").toLowerCase() === "production" && token.length < MIN_PRODUCTION_TOKEN_LENGTH) {
    throw new Error(
      `MCP_BEARER_TOKEN must be at least ${MIN_PRODUCTION_TOKEN_LENGTH} characters when NODE_ENV=production.`
    );
  }
  return token;
}

function tokensEqual(expected, provided) {
  if (typeof expected !== "string" || typeof provided !== "string") return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(provided);
  if (a.length === 0 || a.length !== b.length) {
    // Still run a compare to keep the timing closer when lengths differ.
    const dummy = Buffer.alloc(a.length || 1);
    timingSafeEqual(dummy, dummy);
    return false;
  }
  return timingSafeEqual(a, b);
}

function parseBearerToken(authorizationHeader) {
  if (typeof authorizationHeader !== "string") return null;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(authorizationHeader);
  return match ? match[1] : null;
}

function sendUnauthorized(res) {
  if (res.headersSent) return;
  res.setHeader("WWW-Authenticate", 'Bearer realm="CodeSentinel MCP", error="invalid_token"');
  res.status(401).json({
    jsonrpc: "2.0",
    error: { code: -32001, message: "Unauthorized" },
    id: null,
  });
}

function bearerAuth(expectedToken) {
  return function bearerAuthMiddleware(req, res, next) {
    if (req.method === "OPTIONS") {
      next();
      return;
    }
    const provided = parseBearerToken(req.headers.authorization);
    if (!provided || !tokensEqual(expectedToken, provided)) {
      sendUnauthorized(res);
      return;
    }
    next();
  };
}

module.exports = {
  MIN_PRODUCTION_TOKEN_LENGTH,
  configuredBearerToken,
  requireConfiguredToken,
  tokensEqual,
  parseBearerToken,
  sendUnauthorized,
  bearerAuth,
};
