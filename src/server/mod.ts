/**
 * BetterRTX build server module.
 *
 * Exposes a factory function to create and start the HTTP server
 * with SQLite-backed build queue and WebSocket pub-sub for
 * real-time build status notifications.
 */

import type { Server } from "bun";
import type { ServerConfig, WebSocketData } from "./types.ts";
import type { RawSettings } from "../betterrtx/settings.ts";
import { createCorsHeaders } from "./cors.ts";
import { createBuildCache } from "./build-cache.ts";
import { createDatabase, type BuildDatabase } from "./db.ts";
import { createQueueWorker, type QueueWorker } from "./queue.ts";
import { createWebSocketHandlers } from "./ws.ts";
import {
  createGetRoot,
  createPostBuild,
  createGetBuilds,
  createGetCacheStats,
  createFetchHandler,
  type RouteContext,
} from "./routes.ts";
import { disposeDxcCompiler } from "../dxc/mod.ts";
import { resetShaderCache } from "./shader-cache.ts";
import {
  createMcpSessionManager,
  type McpSessionManager,
} from "../mcp/mod.ts";

// ── Re-exports ──────────────────────────────────────────────────

export type { ServerConfig } from "./types.ts";
export type {
  BuildResult,
  CompiledMaterialOutput,
  CacheEntry,
  BuildJob,
  BuildStatus,
  BuildStatusMessage,
  WebSocketData,
} from "./types.ts";
export {
  ServerError,
  BuildTimeoutError,
  BuildConcurrencyError,
  ShaderDataError,
  JobNotFoundError,
} from "./errors.ts";
export { resetShaderCache } from "./shader-cache.ts";
export { createBuildCache, type BuildCache } from "./build-cache.ts";
export { createDatabase, type BuildDatabase } from "./db.ts";
export { createQueueWorker, type QueueWorker } from "./queue.ts";

// ── Module State ────────────────────────────────────────────────

let _db: BuildDatabase | null = null;
let _worker: QueueWorker | null = null;
let _mcpSessions: McpSessionManager | null = null;

// ── Default Configuration ───────────────────────────────────────

const DEFAULT_CONFIG: ServerConfig = {
  port: 3000,
  corsOrigin: process.env["CORS_ORIGIN"] ?? "http://localhost:3000",
  buildTimeoutMs: 120_000,
  maxCacheEntries: 50,
  shadersVolume: process.env["SHADERS_PATH"] ?? "/shaders",
  archivePrefix: "shader_source/",
  dbPath: process.env["DB_PATH"] ?? "./builds.sqlite",
  maxDbBuilds: 200,
};

// ── Server Factory ──────────────────────────────────────────────

/**
 * Create and start the BetterRTX build server.
 *
 * Opens a SQLite database, starts a queue worker, and serves HTTP
 * with WebSocket pub-sub for real-time build status updates.
 *
 * @param config - Partial server configuration (merged over defaults)
 * @param defaults - Default shader settings (merged under user settings)
 * @returns The Bun server instance for programmatic control
 */
export function createServer(
  config?: Partial<ServerConfig>,
  defaults?: RawSettings,
): Server<WebSocketData> {
  const fullConfig: ServerConfig = { ...DEFAULT_CONFIG, ...config };
  const corsHeaders = createCorsHeaders(fullConfig.corsOrigin);
  const archiveCache = createBuildCache(fullConfig.maxCacheEntries);
  const db = createDatabase(fullConfig.dbPath);
  _db = db;

  const mcpSessions = createMcpSessionManager({
    db,
    defaults: defaults ?? {},
  });
  _mcpSessions = mcpSessions;

  const ctx: RouteContext = {
    config: fullConfig,
    corsHeaders,
    db,
    archiveCache,
    defaults: defaults ?? {},
    mcpSessions,
  };

  const wsHandlers = createWebSocketHandlers();
  const fetchHandler = createFetchHandler(ctx);

  const server = Bun.serve<WebSocketData>({
    port: fullConfig.port,
    routes: {
      "/": { GET: createGetRoot(ctx) },
      "/build": { POST: createPostBuild(ctx) },
      "/builds": { GET: createGetBuilds(ctx) },
      "/cache/stats": { GET: createGetCacheStats(ctx) },
    },
    fetch(req, server) {
      return fetchHandler(req, server);
    },
    websocket: wsHandlers,
  });

  // Start queue worker with access to the server for publishing
  const worker = createQueueWorker(
    db,
    server,
    archiveCache,
    fullConfig,
    defaults ?? {},
  );
  worker.start();
  _worker = worker;

  console.log(
    `[Server] BetterRTX build server running on port ${fullConfig.port}`,
  );
  console.log(`[Server] CORS: ${fullConfig.corsOrigin}`);
  console.log(`[Server] Database: ${fullConfig.dbPath}`);
  console.log(`[Server] WebSocket: ws://localhost:${fullConfig.port}/ws`);
  console.log(`[Server] MCP: http://localhost:${fullConfig.port}/mcp`);

  return server;
}

/**
 * Cleanup all server resources.
 * Call on graceful shutdown to stop the queue worker, close the
 * database, release DXC COM objects, and clean up temp files.
 */
export async function disposeServer(): Promise<void> {
  if (_mcpSessions) {
    await _mcpSessions.closeAll();
    _mcpSessions = null;
  }

  if (_worker) {
    await _worker.stop();
    _worker = null;
  }

  if (_db) {
    _db.close();
    _db = null;
  }

  disposeDxcCompiler();
  await resetShaderCache();
}
