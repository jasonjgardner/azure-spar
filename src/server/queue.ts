/**
 * Build queue worker.
 *
 * Polls the SQLite database for pending build jobs, processes them
 * one at a time, and publishes real-time status updates via WebSocket.
 *
 * DXC FFI blocks the event loop per shader, so parallel builds offer
 * no benefit — the queue naturally serializes work.
 */

import type { Server } from "bun";
import type { ServerConfig, BuildStatusMessage, WebSocketData } from "./types.ts";
import type { BuildDatabase } from "./db.ts";
import type { BuildCache } from "./build-cache.ts";
import type { RawSettings } from "../betterrtx/settings.ts";
import { parseSettingsJson, settingsToDefines } from "../betterrtx/settings.ts";
import { mergeSettings } from "./settings.ts";
import { loadShaderData } from "./shader-cache.ts";
import { buildAllMaterials } from "./build-pipeline.ts";
import { createMaterialArchive } from "./archive.ts";

/** Queue worker control interface. */
export interface QueueWorker {
  readonly start: () => void;
  readonly stop: () => Promise<void>;
  readonly isRunning: () => boolean;
}

const GLOBAL_TOPIC = "builds";
const MIN_POLL_MS = 100;
const MAX_POLL_MS = 1000;

/**
 * Create a build queue worker that processes pending jobs from the database.
 *
 * @param db - Build database instance
 * @param server - Bun server instance (for WebSocket publishing)
 * @param archiveCache - LRU cache for completed archives
 * @param config - Server configuration
 * @param defaults - Default shader settings
 */
export function createQueueWorker(
  db: BuildDatabase,
  server: Server<WebSocketData>,
  archiveCache: BuildCache,
  config: ServerConfig,
  defaults: RawSettings,
): QueueWorker {
  let running = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pollMs = MIN_POLL_MS;
  let activePromise: Promise<void> | null = null;

  function publish(id: string, message: BuildStatusMessage): void {
    const json = JSON.stringify(message);
    server.publish(GLOBAL_TOPIC, json);
    server.publish(`build:${id}`, json);
  }

  async function processNext(): Promise<boolean> {
    const job = db.claimNextPending();
    if (!job) return false;

    publish(job.id, {
      type: "status",
      id: job.id,
      status: "building",
      settingsHash: job.settingsHash,
    });

    try {
      const parsed = parseSettingsJson(job.settingsJson);
      const merged = mergeSettings(defaults, parsed);
      const userDefines = settingsToDefines(merged);

      const shaderData = await loadShaderData(
        config.shadersVolume,
        config.archivePrefix,
      );

      const result = await buildAllMaterials(
        shaderData,
        userDefines,
        job.settingsHash,
        { dxcPath: config.dxcPath, timeoutMs: config.buildTimeoutMs },
      );

      const archiveBytes = await createMaterialArchive(result.materials);

      db.completeBuild(job.id, archiveBytes, result.materials.length);
      archiveCache.set(job.id, { archive: archiveBytes });
      db.evictOldBuilds(config.maxDbBuilds);

      console.log(
        `[Queue] Completed ${job.id} (${result.materials.length} materials, ` +
          `${archiveBytes.length} bytes, ${result.elapsedMs.toFixed(0)}ms)`,
      );

      publish(job.id, {
        type: "status",
        id: job.id,
        status: "completed",
        settingsHash: job.settingsHash,
        materialCount: result.materials.length,
        archiveSize: archiveBytes.length,
        elapsedMs: result.elapsedMs,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      db.failBuild(job.id, message);

      console.error(`[Queue] Failed ${job.id}: ${message}`);

      publish(job.id, {
        type: "status",
        id: job.id,
        status: "failed",
        settingsHash: job.settingsHash,
        error: message,
      });
    }

    return true;
  }

  async function tick(): Promise<void> {
    if (!running) return;

    try {
      const work = processNext();
      activePromise = work.then(() => { activePromise = null; });
      const processed = await work;
      // Reset backoff on successful processing, increase on idle
      pollMs = processed ? MIN_POLL_MS : Math.min(pollMs * 2, MAX_POLL_MS);
    } catch (err) {
      console.error("[Queue] Unexpected worker error:", err);
      pollMs = MAX_POLL_MS;
      activePromise = null;
    }

    if (running) {
      timer = setTimeout(() => void tick(), pollMs);
    }
  }

  return {
    start() {
      if (running) return;
      running = true;
      pollMs = MIN_POLL_MS;
      console.log("[Queue] Worker started");
      void tick();
    },

    async stop() {
      running = false;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      // Wait for any in-flight build to finish before returning
      if (activePromise) {
        console.log("[Queue] Waiting for in-flight build to complete...");
        await activePromise;
      }
      console.log("[Queue] Worker stopped");
    },

    isRunning() {
      return running;
    },
  };
}
