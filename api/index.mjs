/**
 * Vercel Fluid Compute entry for Streamable HTTP MCP.
 *
 * Stateless JSON request/response — no sticky sessions, no long-lived GET /mcp
 * SSE. Same tools and Bearer auth as `npm run mcp:http`.
 *
 * Public URL after deploy: https://$VERCEL_PROJECT_PRODUCTION_URL/mcp
 * (do not hardcode a hostname in this repo).
 */

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { handleWebRequest } = require("../mcp-server/web-handler.js");

export const maxDuration = 60;
export const dynamic = "force-dynamic";

export default {
  async fetch(request) {
    return handleWebRequest(request);
  },
};
