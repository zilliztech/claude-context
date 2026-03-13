FROM node:20-slim AS builder
WORKDIR /app
COPY . .
ENV CI=true
RUN npm install -g pnpm && pnpm install --frozen-lockfile
RUN pnpm --filter @zilliz/claude-context-core build \
    && pnpm --filter @zilliz/claude-context-mcp build
RUN pnpm --filter @zilliz/claude-context-mcp deploy --legacy /deploy

FROM node:20-slim
WORKDIR /app
COPY --from=builder /deploy .

ENV MCP_TRANSPORT=sse
ENV MCP_PORT=8000
EXPOSE 8000

CMD ["node", "dist/index.js"]