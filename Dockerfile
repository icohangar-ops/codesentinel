FROM node:18-alpine

WORKDIR /app

COPY mcp-server/package*.json ./mcp-server/
RUN cd mcp-server && npm ci --production

COPY mcp-server/ ./mcp-server/

EXPOSE 3000

CMD ["node", "mcp-server/index.js"]
