/**
 * HTTP route handlers for the build server.
 *
 * All handlers receive a RouteContext with injected dependencies
 * (config, CORS headers, database, cache, defaults) for testability.
 *
 * POST /build is async — returns 202 Accepted with a job ID.
 * Parameterized routes (/build/:id, /build/:id/archive) are matched
 * in the fetch handler via URL parsing (not Bun's routes object).
 */

import type { ServerConfig } from "./types.ts";
import type { CorsHeaders } from "./cors.ts";
import type { BuildCache } from "./build-cache.ts";
import type { BuildDatabase } from "./db.ts";
import type { McpSessionManager } from "../mcp/mod.ts";
import { jsonResponse, errorResponse } from "./cors.ts";
import { processSettings } from "./settings.ts";
import { JobNotFoundError } from "./errors.ts";
import { SettingsError, type RawSettings } from "../betterrtx/settings.ts";

// ── Route Context ───────────────────────────────────────────────

/** Dependencies injected into route handlers. */
export interface RouteContext {
  readonly config: ServerConfig;
  readonly corsHeaders: CorsHeaders;
  readonly db: BuildDatabase;
  readonly archiveCache: BuildCache;
  readonly defaults: RawSettings;
  readonly mcpSessions: McpSessionManager | null;
}

// ── Max request body size (64 KB) ───────────────────────────────

const MAX_BODY_SIZE = 64 * 1024;
const MAX_QUEUE_DEPTH = 100;

// ── Fixed Route Handlers (used in Bun.serve routes object) ──────

/** GET / — Health check and service info. */
export function createGetRoot(ctx: RouteContext) {
  return (): Response =>
    jsonResponse(
      {
        service: "azure-spar",
        status: "ok",
        queueDepth: ctx.db.countByStatus("pending"),
        activeBuilds: ctx.db.countByStatus("building"),
        totalBuilds: ctx.db.countTotal(),
      },
      ctx.corsHeaders,
    );
}

/**
 * POST /build — Submit a build job (async).
 *
 * Request body: JSON settings object (max 64 KB).
 * Response: 202 { id, status, settingsHash }
 *
 * Deduplication: if a completed/pending/building build with the same
 * settings hash exists, returns the existing job instead of creating
 * a duplicate.
 */
export function createPostBuild(ctx: RouteContext) {
  return async (req: Request): Promise<Response> => {
    // CRITICAL-2 fix: Require Content-Length to prevent unbounded body reads
    const contentLengthHeader = req.headers.get("content-length");
    if (!contentLengthHeader) {
      return errorResponse("Content-Length header required", ctx.corsHeaders, 411);
    }

    const contentLength = parseInt(contentLengthHeader, 10);
    if (Number.isNaN(contentLength) || contentLength > MAX_BODY_SIZE) {
      return errorResponse("Request body too large", ctx.corsHeaders, 413);
    }

    let rawJson: string;
    try {
      rawJson = await req.text();
    } catch {
      return errorResponse("Failed to read request body", ctx.corsHeaders, 400);
    }

    if (!rawJson.trim()) {
      return errorResponse("Request body is empty", ctx.corsHeaders, 400);
    }

    // Double-check actual length (Content-Length can be spoofed)
    if (rawJson.length > MAX_BODY_SIZE) {
      return errorResponse("Request body too large", ctx.corsHeaders, 413);
    }

    let hash: string;
    try {
      const result = processSettings(rawJson, ctx.defaults);
      hash = result.hash;
    } catch (err) {
      if (err instanceof SettingsError) {
        return errorResponse(err.message, ctx.corsHeaders, 400);
      }
      return errorResponse("Invalid settings", ctx.corsHeaders, 400);
    }

    // Rate limit: reject if queue is too deep
    const pending = ctx.db.countByStatus("pending");
    if (pending >= MAX_QUEUE_DEPTH) {
      return errorResponse(
        "Build queue is full, try again later",
        ctx.corsHeaders,
        503,
      );
    }

    // Atomic deduplicate-or-insert (prevents TOCTOU race)
    const id = crypto.randomUUID();
    const { job, inserted } = ctx.db.insertOrFindByHash(id, hash, rawJson);

    if (!inserted) {
      return jsonResponse(
        {
          id: job.id,
          status: job.status,
          settingsHash: job.settingsHash,
          deduplicated: true,
        },
        ctx.corsHeaders,
        job.status === "completed" ? 200 : 202,
      );
    }

    return jsonResponse(
      { id: job.id, status: "pending", settingsHash: hash },
      ctx.corsHeaders,
      202,
    );
  };
}

/** GET /builds — List recent builds with pagination. */
export function createGetBuilds(ctx: RouteContext) {
  return (req: Request): Response => {
    const url = new URL(req.url);
    const limit = Math.min(
      Math.max(parseInt(url.searchParams.get("limit") ?? "20", 10) || 20, 1),
      100,
    );
    const offset = Math.max(
      parseInt(url.searchParams.get("offset") ?? "0", 10) || 0,
      0,
    );

    const builds = ctx.db.listBuilds(limit, offset);
    const total = ctx.db.countTotal();

    return jsonResponse({ builds, total, limit, offset }, ctx.corsHeaders);
  };
}

/** GET /cache/stats — Return cache and queue statistics. */
export function createGetCacheStats(ctx: RouteContext) {
  return (): Response =>
    jsonResponse(
      {
        memCached: ctx.archiveCache.size(),
        maxCacheEntries: ctx.config.maxCacheEntries,
        dbBuilds: ctx.db.countTotal(),
        maxDbBuilds: ctx.config.maxDbBuilds,
        queueDepth: ctx.db.countByStatus("pending"),
        activeBuilds: ctx.db.countByStatus("building"),
        completedBuilds: ctx.db.countByStatus("completed"),
        failedBuilds: ctx.db.countByStatus("failed"),
      },
      ctx.corsHeaders,
    );
}

// ── Parameterized Route Handlers (called from fetch handler) ────

/** GET /build/:id — Return build job status. */
export function handleGetBuildStatus(
  ctx: RouteContext,
  id: string,
): Response {
  const job = ctx.db.findById(id);
  if (!job) {
    return errorResponse(
      new JobNotFoundError(id).message,
      ctx.corsHeaders,
      404,
    );
  }

  return jsonResponse(job, ctx.corsHeaders);
}

/** GET /build/:id/archive — Download completed build archive. */
export function handleGetBuildArchive(
  ctx: RouteContext,
  id: string,
): Response {
  const job = ctx.db.findById(id);
  if (!job) {
    return errorResponse(
      new JobNotFoundError(id).message,
      ctx.corsHeaders,
      404,
    );
  }

  if (job.status !== "completed") {
    return errorResponse(
      `Build is ${job.status}, archive not available yet`,
      ctx.corsHeaders,
      409,
    );
  }

  // Check LRU cache first
  const cached = ctx.archiveCache.get(id);
  if (cached) {
    return createArchiveResponse(cached.archive, job.settingsHash, ctx.corsHeaders);
  }

  // Fall back to SQLite BLOB
  const archive = ctx.db.getArchive(id);
  if (!archive) {
    return errorResponse(
      "Archive data not found (may have been evicted)",
      ctx.corsHeaders,
      410,
    );
  }

  // Populate LRU cache for next time
  ctx.archiveCache.set(id, { archive });

  return createArchiveResponse(archive, job.settingsHash, ctx.corsHeaders);
}

// ── Fetch Handler (parameterized routes + WS upgrade + CORS) ────

const BUILD_ID_RE = /^\/build\/([0-9a-f-]{36})$/;
const BUILD_ARCHIVE_RE = /^\/build\/([0-9a-f-]{36})\/archive$/;

/**
 * Create the fetch fallback handler for Bun.serve().
 *
 * Handles parameterized routes, WebSocket upgrades, CORS preflight,
 * and 404 for unknown paths.
 */
export function createFetchHandler(ctx: RouteContext) {
  return (req: Request, server: { upgrade: (req: Request, opts: { data: import("./types.ts").WebSocketData }) => boolean }): Response | Promise<Response> | undefined => {
    const url = new URL(req.url);

    // WebSocket upgrade
    if (url.pathname === "/ws") {
      const upgraded = server.upgrade(req, {
        data: { connectedAt: Date.now() },
      });
      if (!upgraded) {
        return errorResponse("WebSocket upgrade failed", ctx.corsHeaders, 400);
      }
      return undefined;
    }

    // CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: ctx.corsHeaders });
    }

    // GET /build/:id
    const statusMatch = url.pathname.match(BUILD_ID_RE);
    if (statusMatch && req.method === "GET") {
      return handleGetBuildStatus(ctx, statusMatch[1]!);
    }

    // GET /build/:id/archive
    const archiveMatch = url.pathname.match(BUILD_ARCHIVE_RE);
    if (archiveMatch && req.method === "GET") {
      return handleGetBuildArchive(ctx, archiveMatch[1]!);
    }

    // MCP Streamable HTTP endpoint
    if (url.pathname === "/mcp" && ctx.mcpSessions) {
      return ctx.mcpSessions.handleRequest(req);
    }

    return jsonResponse(
      { error: "Not Found" },
      ctx.corsHeaders,
      404,
    );
  };
}

// ── Helpers ─────────────────────────────────────────────────────

function createArchiveResponse(
  archive: Uint8Array,
  settingsHash: string,
  corsHeaders: CorsHeaders,
): Response {
  return new Response(archive, {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/gzip",
      "Content-Disposition":
        'attachment; filename="betterrtx-materials.tar.gz"',
      "X-Settings-Hash": settingsHash,
    },
  });
}
