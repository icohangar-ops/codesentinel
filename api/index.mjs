/**
 * Vercel Fluid Compute entry for Streamable HTTP MCP.
 *
 * Stateless JSON request/response — no sticky sessions, no long-lived GET /mcp
 * SSE. Same tools and Bearer auth as `npm run mcp:http`.
 *
 * Import the CJS handler as ESM (do not createRequire). createRequire() plus
 * a CJS graph that `require()`s ESM-only packages (octokit) is what produced
 * ERR_REQUIRE_ESM on Vercel, where require(esm) is disabled.
 *
 * Public URL after deploy: https://$VERCEL_PROJECT_PRODUCTION_URL/mcp
 * (do not hardcode a hostname in this repo).
 *
 * Fail-closed like mcp-server/http.js: MCP_BEARER_TOKEN must be set in the
 * Vercel project env. GET /health returns 503 (not 200) when it is unset —
 * enforced inside handleWebRequest (same requireConfiguredToken helper).
 */

import { handleWebRequest } from "../mcp-server/web-handler.js";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export default {
  async fetch(request) {
    return handleWebRequest(request);
  },
};
