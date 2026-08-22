#!/usr/bin/env bash
# Publish CodeSentinel MCPB to Smithery (stdio).
set -euo pipefail
cd "$(dirname "$0")/.."

SERVER_SLUG="${SMITHERY_SERVER_SLUG:-codesentinel}"
VERSION="$(node -p "require('./package.json').version")"
BUNDLE="${1:-dist/codesentinel-mcp-${VERSION}.mcpb}"

if [[ -n "${SMITHERY_QUALIFIED_NAME:-}" ]]; then
  QUALIFIED_NAME="${SMITHERY_QUALIFIED_NAME}"
else
  NS="$(smithery namespace show 2>/dev/null | awk '/Namespace:/ {print $2}')"
  [[ -n "${NS}" ]] || { echo "Set SMITHERY_QUALIFIED_NAME or run smithery namespace show"; exit 1; }
  QUALIFIED_NAME="${NS}/${SERVER_SLUG}"
fi

command -v smithery >/dev/null || { echo "npm install -g smithery@latest"; exit 1; }
[[ -f "${BUNDLE}" ]] || { echo "Run: npm run mcpb:pack"; exit 1; }
smithery auth whoami >/dev/null 2>&1 || { echo "smithery auth login"; exit 1; }

echo "Publishing -> ${QUALIFIED_NAME}"
smithery mcp publish "${BUNDLE}" -n "${QUALIFIED_NAME}" || {
  echo "Namespace missing? smithery namespace create icohangar-ops && smithery namespace use icohangar-ops"
  exit 1
}
