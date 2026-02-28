# ── Stage 1: DXC Compiler ─────────────────────────────────────────
FROM jasongardner/dxc:latest AS dxc
RUN dxc --version

# ── Stage 2: Bun Runtime ──────────────────────────────────────────
FROM oven/bun:latest AS base

# Copy DXC binaries from the first stage
COPY --from=dxc /opt/dxc /opt/dxc
ENV PATH="/opt/dxc/bin:$PATH"

# ── Install tigrisfs for R2 FUSE mount ────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
    fuse3 ca-certificates curl && \
    curl -fsSL -L -o /tmp/tigrisfs.tar.gz \
    https://github.com/tigrisdata/tigrisfs/releases/latest/download/tigrisfs_1.2.1_linux_amd64.tar.gz && \
    tar -xzf /tmp/tigrisfs.tar.gz -C /tmp && \
    mv /tmp/tigrisfs /usr/local/bin/tigrisfs && \
    chmod +x /usr/local/bin/tigrisfs && \
    rm -rf /tmp/tigrisfs* && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

# ── Environment Variables ─────────────────────────────────────────
ARG CORS_ORIGIN="*"
ENV CORS_ORIGIN=${CORS_ORIGIN}

# Shader data is loaded from the R2 FUSE mount at runtime.
# The mount point is created by the startup script.
ENV SHADERS_PATH=/mnt/r2

# Ephemeral SQLite database (CF Containers have no persistent volumes)
ENV DB_PATH=/tmp/builds.sqlite

# ── Install Dependencies ──────────────────────────────────────────
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

# ── Copy Source ───────────────────────────────────────────────────
COPY src/ ./src/
COPY tsconfig.json ./

# ── Startup Script ────────────────────────────────────────────────
# Mounts the R2 bucket read-only via tigrisfs, then starts the server.
RUN printf '#!/bin/sh\n\
    set -e\n\
    mkdir -p /mnt/r2\n\
    R2_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"\n\
    /usr/local/bin/tigrisfs --endpoint "${R2_ENDPOINT}" -o ro -f "${R2_BUCKET_NAME}" /mnt/r2 &\n\
    sleep 3\n\
    echo "R2 mount contents:"\n\
    ls -la /mnt/r2\n\
    exec bun run src/serve.ts\n\
    ' > /startup.sh && chmod +x /startup.sh

# ── Runtime ───────────────────────────────────────────────────────
EXPOSE 3000/tcp

ENTRYPOINT ["/startup.sh"]
