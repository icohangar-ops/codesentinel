#!/usr/bin/env bash
# Mint execute-only agent token (browser-safe) for Smithery Connect.
# https://smithery.ai/docs/use/token-scoping#execute-only-agent-token
set -euo pipefail

NAMESPACE="${SMITHERY_NAMESPACE:-icohangar-ops}"
USER_ID="${SMITHERY_USER_ID:?Set SMITHERY_USER_ID for metadata.userId}"
TTL="${SMITHERY_TOKEN_TTL:-30m}"

command -v smithery >/dev/null || { echo "npm install -g smithery@latest"; exit 1; }
smithery auth whoami >/dev/null 2>&1 || { echo "smithery auth login"; exit 1; }

smithery auth token --policy "[{
  \"namespaces\": \"${NAMESPACE}\",
  \"resources\": \"connections\",
  \"operations\": \"execute\",
  \"metadata\": { \"userId\": \"${USER_ID}\" },
  \"ttl\": \"${TTL}\"
}]"
