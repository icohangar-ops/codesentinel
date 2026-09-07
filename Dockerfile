FROM node:20-alpine

WORKDIR /app

# Full repo is required: HTTP entry imports ../lib and ../src analyzers.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY mcp-server ./mcp-server
COPY lib ./lib
COPY src ./src

ENV NODE_ENV=production
ENV MCP_HTTP_HOST=0.0.0.0
ENV PORT=8787

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Streamable HTTP (stateless). Requires MCP_BEARER_TOKEN at runtime.
CMD ["node", "mcp-server/http.js"]
