# Glama MCP introspection (stdio). Paste into Glama Dockerfile admin if needed.
# Node 22: Glama's Node 23 Nodesource install has failed in the past.

FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json ./
COPY mcp-server ./mcp-server
COPY lib ./lib

RUN npm ci --omit=dev --no-audit --no-fund \
  && npm cache clean --force

ENV NODE_ENV=production
ENV DAYTONA_DISABLE=1

CMD ["node", "mcp-server/index.js"]
