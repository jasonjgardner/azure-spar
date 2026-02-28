# ── Stage 1: DXC Compiler ─────────────────────────────────────────
FROM jasongardner/dxc:latest AS dxc
RUN dxc --version

# ── Stage 2: Bun Runtime ──────────────────────────────────────────
FROM oven/bun:latest AS base

# Copy DXC binaries from the first stage
COPY --from=dxc /opt/dxc /opt/dxc
ENV PATH="/opt/dxc/bin:$PATH"

WORKDIR /usr/src/app

# ── Environment Variables ─────────────────────────────────────────
ARG CORS_ORIGIN="*"
ENV CORS_ORIGIN=${CORS_ORIGIN}

# Shaders volume - expected contents:
#   /shaders/shader_source.tar.gz          (BetterRTX HLSL sources)
#   /shaders/vanilla/RTXStub.material.bin
#   /shaders/vanilla/RTXPostFX.Tonemapping.material.bin
#   /shaders/vanilla/RTXPostFX.Bloom.material.bin
ENV SHADERS_PATH=/shaders
VOLUME /shaders

# Build output and SQLite database
ENV DB_PATH=/data/builds.sqlite
VOLUME /data

# ── Install Dependencies ──────────────────────────────────────────
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

# ── Copy Source ───────────────────────────────────────────────────
COPY src/ ./src/
COPY tsconfig.json ./

# ── Runtime ───────────────────────────────────────────────────────
EXPOSE 3000/tcp

ENTRYPOINT ["bun", "run", "src/serve.ts"]
