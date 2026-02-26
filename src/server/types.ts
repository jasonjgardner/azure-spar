/**
 * Type definitions for the BetterRTX build server.
 */

import type { MaterialManifest } from "../betterrtx/manifest-types.ts";

/** Configuration for the HTTP server. */
export interface ServerConfig {
  /** Port to listen on. Default: 3000. */
  readonly port: number;
  /** CORS allowed origin. Default: "*". */
  readonly corsOrigin: string;
  /** Path to dxcompiler.dll (auto-detected if omitted). */
  readonly dxcPath?: string;
  /** Build timeout in milliseconds. Default: 120_000 (2 minutes). */
  readonly buildTimeoutMs: number;
  /** Maximum number of in-memory cached archives (LRU hot-read layer). Default: 50. */
  readonly maxCacheEntries: number;
  /** Root path containing shader_source.tar.gz and vanilla/ directory. */
  readonly shadersVolume: string;
  /** Prefix path inside the shader archive. Default: "shader_source/". */
  readonly archivePrefix: string;
  /** Path to the SQLite database file. Default: "./builds.sqlite". */
  readonly dbPath: string;
  /** Maximum completed builds to keep in SQLite before eviction. Default: 200. */
  readonly maxDbBuilds: number;
}

/** Lazy-loaded shader data cached at module level. */
export interface ShaderData {
  readonly manifests: readonly MaterialManifest[];
  readonly registerBindings: Readonly<
    Record<string, Readonly<Record<string, string>>>
  >;
  readonly shaderFiles: ReadonlyMap<string, Uint8Array>;
  readonly tempShadersRoot: string;
}

/** A single compiled material output. */
export interface CompiledMaterialOutput {
  readonly materialName: string;
  readonly fileName: string;
  readonly binary: Uint8Array;
}

/** Result of a full build (all 3 materials). */
export interface BuildResult {
  readonly materials: readonly CompiledMaterialOutput[];
  readonly settingsHash: string;
  readonly elapsedMs: number;
}

/** Cached archive bytes for LRU hot-read layer (keyed by build ID). */
export interface CacheEntry {
  readonly archive: Uint8Array;
}

// ── Build Queue Types ────────────────────────────────────────────

/** Build job status. */
export type BuildStatus = "pending" | "building" | "completed" | "failed";

/** A build job stored in SQLite. */
export interface BuildJob {
  readonly id: string;
  readonly settingsHash: string;
  readonly settingsJson: string;
  readonly status: BuildStatus;
  readonly error: string | null;
  readonly createdAt: number;
  readonly startedAt: number | null;
  readonly completedAt: number | null;
  readonly materialCount: number | null;
  readonly archiveSize: number | null;
}

/** WebSocket connection data (attached to ws.data). */
export interface WebSocketData {
  readonly connectedAt: number;
}

/** WebSocket status message sent to clients. */
export interface BuildStatusMessage {
  readonly type: "status";
  readonly id: string;
  readonly status: BuildStatus;
  readonly settingsHash: string;
  readonly error?: string;
  readonly materialCount?: number;
  readonly archiveSize?: number;
  readonly elapsedMs?: number;
  readonly queuePosition?: number;
}

/** Target material names (the 3 materials every build produces). */
export const TARGET_MATERIALS = [
  "RTXStub",
  "RTXPostFX.Tonemapping",
  "RTXPostFX.Bloom",
] as const;

export type TargetMaterial = (typeof TARGET_MATERIALS)[number];

/** Material file names for archive entries. */
export const MATERIAL_FILES: Readonly<Record<TargetMaterial, string>> = {
  RTXStub: "RTXStub.material.bin",
  "RTXPostFX.Tonemapping": "RTXPostFX.Tonemapping.material.bin",
  "RTXPostFX.Bloom": "RTXPostFX.Bloom.material.bin",
} as const;
