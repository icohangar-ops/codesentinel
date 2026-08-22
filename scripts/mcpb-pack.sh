#!/usr/bin/env bash
# Build MCPB for CodeSentinel stdio MCP (Slack manifest.json stays at repo root).
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION="$(node -p "require('./package.json').version")"
OUT="dist/codesentinel-mcp-${VERSION}.mcpb"
STAGE="$(mktemp -d)"
trap 'rm -rf "${STAGE}"' EXIT

echo "==> production deps"
npm ci --no-audit --no-fund

echo "==> stage ${STAGE}"
cp mcpb/manifest.json "${STAGE}/manifest.json"
cp package.json package-lock.json LICENSE README.md "${STAGE}/"
cp -R mcp-server lib node_modules "${STAGE}/"

echo "==> validate"
mcpb validate "${STAGE}/manifest.json"

echo "==> pack -> ${OUT}"
mkdir -p dist
mcpb pack "${STAGE}" "${OUT}"

echo "==> smoke"
export DAYTONA_DISABLE=1
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"mcpb-pack-smoke","version":"0.0.0"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' \
| node mcp-server/index.js > /tmp/codesentinel-mcpb-smoke.ndjson
grep -q '"name":"CodeSentinel"' /tmp/codesentinel-mcpb-smoke.ndjson
grep -q 'analyze_dead_code' /tmp/codesentinel-mcpb-smoke.ndjson
echo "OK: ${OUT} ($(du -h "${OUT}" | cut -f1))"

echo
echo "Smithery: smithery auth login && npm run smithery:publish"
