import { EMBEDDED_SHADERS } from "./shader-imports.ts";
import type { MaterialManifest } from "./shader-manifest.ts";

export type { ShaderEntry, MaterialManifest } from "./shader-manifest.ts";
export { BETTERRTX_MANIFESTS } from "./shader-manifest.ts";
export {
  extractRegisterDefines,
  registerDefinesToArgs,
  mergeRegisterDefines,
} from "./register-bindings.ts";

/**
 * Load a shader source from embedded files.
 * Returns the HLSL source as a Uint8Array (UTF-8).
 *
 * In compiled mode: reads from Bun's baked-in virtual filesystem.
 * In dev mode: reads from the real filesystem.
 * Either way, the source stays in-memory.
 */
export async function loadShaderSource(fileName: string): Promise<Uint8Array> {
  const path = EMBEDDED_SHADERS.get(fileName);
  if (!path) {
    throw new Error(`Shader "${fileName}" not found in embedded files`);
  }

  const blob = Bun.file(path);
  const buffer = await blob.arrayBuffer();
  return new Uint8Array(buffer);
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
