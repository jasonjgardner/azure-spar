/**
 * BetterRTX shader loading and manifest management.
 *
 * In compiled mode: shaders are discovered via `Bun.embeddedFiles` (baked
 * into the executable by `bun build --compile ... ./shaders/**\/*.hlsl`).
 *
 * In dev mode: shaders are read directly from the `shaders/` directory
 * on disk (populated by scripts/setup.ts).
 */

import { resolve } from "node:path";
import type { MaterialManifest } from "./manifest-types.ts";

export type { ShaderEntry, MaterialManifest } from "./manifest-types.ts";
export {
  extractRegisterDefines,
  registerDefinesToArgs,
  mergeRegisterDefines,
} from "./register-bindings.ts";

// ── Shader Map (lazy-initialized) ──────────────────────────────

const SHADERS_PREFIX = "shaders/";
const DEV_SHADERS_DIR = resolve(import.meta.dir, "../../shaders");

let _shaderMap: ReadonlyMap<string, Blob> | null = null;

/** Bun.embeddedFiles elements have a `name` property at runtime. */
type EmbeddedBlob = Blob & { readonly name: string };

/**
 * Build a map from shader relative paths to embedded Blob objects.
 * Returns an empty map in dev mode (loadShaderSource falls back to disk).
 */
function getShaderMap(): ReadonlyMap<string, Blob> {
  if (_shaderMap) return _shaderMap;

  const map = new Map<string, Blob>();
  const files = Bun.embeddedFiles as readonly EmbeddedBlob[];

  for (const file of files) {
    if (!file.name.startsWith(SHADERS_PREFIX)) continue;
    const key = file.name.slice(SHADERS_PREFIX.length);
    map.set(key, file);
  }

  _shaderMap = map;
  return map;
}

// ── Shader Source Loading ──────────────────────────────────────

/**
 * Load a shader source by its relative path.
 * Returns the HLSL source as a Uint8Array (UTF-8).
 *
 * In compiled mode: reads from Bun's baked-in virtual filesystem.
 * In dev mode: reads from the shaders/ directory on disk.
 */
export async function loadShaderSource(fileName: string): Promise<Uint8Array> {
  // Try embedded files first (compiled mode)
  const embedded = getShaderMap().get(fileName);
  if (embedded) {
    return new Uint8Array(await embedded.arrayBuffer());
  }

  // Dev mode fallback: read from filesystem
  const devPath = resolve(DEV_SHADERS_DIR, fileName);
  const file = Bun.file(devPath);

  if (await file.exists()) {
    return new Uint8Array(await file.arrayBuffer());
  }

  throw new Error(`Shader "${fileName}" not found in embedded files or filesystem`);
}

/**
 * Load all shader sources for a material manifest.
 * Returns a Map from fileName to UTF-8 source bytes.
 */
export async function loadManifestSources(
  manifest: MaterialManifest,
): Promise<ReadonlyMap<string, Uint8Array>> {
  const entries = await Promise.all(
    manifest.shaders.map(async (shader) => {
      const source = await loadShaderSource(shader.fileName);
      return [shader.fileName, source] as const;
    }),
  );
  return new Map(entries);
}

// ── Manifest Loading ───────────────────────────────────────────

// ── Register Bindings Loading ─────────────────────────────────

const REGISTER_BINDINGS_KEY = "register-bindings.json";

let _registerBindings: Readonly<
  Record<string, Readonly<Record<string, string>>>
> | null = null;

/**
 * Load register binding defines for all materials.
 *
 * In compiled mode: reads from the embedded register-bindings.json.
 * In dev mode: reads from shaders/register-bindings.json on disk.
 */
export async function loadRegisterBindings(): Promise<
  Readonly<Record<string, Readonly<Record<string, string>>>>
> {
  if (_registerBindings) return _registerBindings;

  const embedded = getShaderMap().get(REGISTER_BINDINGS_KEY);
  if (embedded) {
    _registerBindings = JSON.parse(await embedded.text()) as Record<
      string,
      Record<string, string>
    >;
    return _registerBindings;
  }

  const devPath = resolve(DEV_SHADERS_DIR, REGISTER_BINDINGS_KEY);
  const file = Bun.file(devPath);
  if (await file.exists()) {
    _registerBindings = (await file.json()) as Record<
      string,
      Record<string, string>
    >;
    return _registerBindings;
  }

  _registerBindings = {};
  return _registerBindings;
}

// ── Manifest Loading ───────────────────────────────────────────

const MANIFEST_KEY = "manifest.json";

let _manifests: readonly MaterialManifest[] | null = null;

/**
 * Load BetterRTX shader manifests.
 *
 * In compiled mode: reads from the embedded manifest.json.
 * In dev mode: reads from shaders/manifest.json on disk.
 */
export async function loadManifests(): Promise<readonly MaterialManifest[]> {
  if (_manifests) return _manifests;

  // Try embedded manifest first (compiled mode)
  const embedded = getShaderMap().get(MANIFEST_KEY);
  if (embedded) {
    _manifests = JSON.parse(await embedded.text()) as MaterialManifest[];
    return _manifests;
  }

  // Dev mode fallback: read from filesystem
  const devPath = resolve(DEV_SHADERS_DIR, MANIFEST_KEY);
  _manifests = (await Bun.file(devPath).json()) as MaterialManifest[];
  return _manifests;
}
