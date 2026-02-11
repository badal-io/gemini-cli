# Stage 1: Build gemini-cli monorepo
FROM node:20-bookworm-slim AS builder
WORKDIR /build
# Copy only what the build needs — avoids sending the full repo as context
COPY package.json package-lock.json tsconfig.json ./
COPY packages/ packages/
COPY scripts/ scripts/
# --ignore-scripts skips the "prepare" hook (husky + bundle) which
# fails without a full git repo and esbuild.config.js.
# We then run generate (gracefully handles missing git) and build each workspace.
RUN npm ci --ignore-scripts \
    && npm run generate \
    && npm run build --workspaces
RUN cd packages/core && npm pack && mv *.tgz /tmp/gemini-core.tgz \
    && cd ../cli && npm pack && mv *.tgz /tmp/gemini-cli.tgz \
    && cd ../a2a-server && npm pack && mv *.tgz /tmp/gemini-a2a-server.tgz

# Stage 2: Build captain-hook (Rust binary)
FROM rust:slim AS captain-hook-builder
RUN apt-get update && apt-get install -y --no-install-recommends git pkg-config libssl-dev g++ && rm -rf /var/lib/apt/lists/*
# Remove Rust docs to save ~500MB disk during build
RUN rm -rf /usr/local/rustup/toolchains/*/share/doc
RUN git clone --depth 1 https://github.com/epiphytic/captain-hook.git /build
WORKDIR /build
RUN cargo build --release && rm -rf target/release/deps target/release/build target/release/.fingerprint

# Stage 3: Build ai-plugin-translator
FROM node:20-bookworm-slim AS translator-builder
RUN npm install -g pnpm
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && rm -rf /var/lib/apt/lists/*
RUN git clone https://github.com/epiphytic/ai-plugin-translator.git /build
WORKDIR /build
RUN pnpm install && pnpm build

# Stage 4: Final runtime image (multi-arch: amd64 + arm64)
FROM node:20-bookworm-slim

# Install runtime dependencies only
RUN apt-get update && apt-get install -y --no-install-recommends \
      git \
      curl \
      socat \
      ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install gh CLI (supports both amd64 and arm64)
RUN ARCH="$(dpkg --print-architecture)" && \
    curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
      -o /usr/share/keyrings/githubcli-archive-keyring.gpg && \
    echo "deb [arch=${ARCH} signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
      > /etc/apt/sources.list.d/github-cli.list && \
    apt-get update && apt-get install -y --no-install-recommends gh && \
    rm -rf /var/lib/apt/lists/*

# Set up npm global prefix
RUN mkdir -p /usr/local/share/npm-global
ENV NPM_CONFIG_PREFIX=/usr/local/share/npm-global
ENV PATH=$PATH:/usr/local/share/npm-global/bin

# Install gemini-cli packages globally
COPY --from=builder /tmp/gemini-core.tgz /tmp/gemini-core.tgz
COPY --from=builder /tmp/gemini-cli.tgz /tmp/gemini-cli.tgz
COPY --from=builder /tmp/gemini-a2a-server.tgz /tmp/gemini-a2a-server.tgz
RUN npm install -g /tmp/gemini-core.tgz /tmp/gemini-cli.tgz /tmp/gemini-a2a-server.tgz && \
    npm cache clean --force && \
    rm -f /tmp/gemini-*.tgz

# Install extensions
RUN mkdir -p /root/.gemini/extensions

# ai-plugin-translator extension
COPY --from=translator-builder /build /root/.gemini/extensions/ai-plugin-translator

# captain-hook extension
COPY --from=captain-hook-builder /build/target/release/captain-hook /root/.gemini/extensions/captain-hook/captain-hook
COPY --from=captain-hook-builder /build/.claude-plugin /root/.gemini/extensions/captain-hook/.claude-plugin

# Copy settings and entrypoint
COPY deploy/cloudrun/settings.json /root/.gemini/settings.json
COPY deploy/cloudrun/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

WORKDIR /workspace
EXPOSE 8080

ENTRYPOINT ["/entrypoint.sh"]
