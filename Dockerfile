ARG DOCKER_REGISTRY

FROM ${DOCKER_REGISTRY}node:20

WORKDIR /app

# Copy everything
COPY . .

# Set CI=true to avoid interactive prompts
ENV CI=true

# Install pnpm and dependencies
RUN npm install -g pnpm \
    && pnpm install

# Build packages
RUN pnpm --filter @zilliz/claude-context-core build \
    && pnpm --filter @zilliz/claude-context-mcp build

WORKDIR /app/packages/mcp
ENTRYPOINT ["pnpm", "run", "dev:http"]
