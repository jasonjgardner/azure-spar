/**
 * Create tar.gz archives from compiled material binaries.
 *
 * Uses Bun.Archive to produce an in-memory gzip-compressed tar
 * containing all compiled .material.bin files.
 */

import type { CompiledMaterialOutput } from "./types.ts";

/**
 * Bundle compiled material binaries into a tar.gz archive.
 *
 * The archive contains flat entries:
 *   RTXStub.material.bin
 *   RTXPostFX.Tonemapping.material.bin
 *   RTXPostFX.Bloom.material.bin
 */
export async function createMaterialArchive(
  materials: readonly CompiledMaterialOutput[],
): Promise<Uint8Array> {
  const files: Record<string, Uint8Array> = {};

  for (const material of materials) {
    files[material.fileName] = material.binary;
  }

  const archive = new Bun.Archive(files, { compress: "gzip" });
  return await archive.bytes();
}
