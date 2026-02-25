/**
 * Extract register binding defines from a parsed Material.
 *
 * Lazurite passes buffer registers as macros to DXC:
 *   s_<BufferName>_REG → register slot number
 *
 * For example, if a material buffer named "MatTexture" has reg1 = 2,
 * the compiler gets: -D s_MatTexture_REG=2
 *
 * These defines allow BetterRTX HLSL shaders to use CONCAT macros
 * that resolve register(s2), register(t2), etc.
 */

import type { Material } from "../material/material.ts";

/** Extract register binding defines from a material's buffer list. */
export function extractRegisterDefines(
  material: Material,
): Readonly<Record<string, string>> {
  const defines: Record<string, string> = {};

  for (const buffer of material.buffers) {
    if (buffer.name) {
      defines[`s_${buffer.name}_REG`] = String(buffer.reg1);
    }
  }

  return defines;
}

/** Format register defines as DXC -D arguments. */
export function registerDefinesToArgs(
  defines: Readonly<Record<string, string>>,
): readonly string[] {
  return Object.entries(defines).flatMap(([key, value]) => [
    "-D",
    `${key}=${value}`,
  ]);
}

/**
 * Merge register defines from multiple materials.
 * Later entries override earlier ones if there are conflicts.
 */
export function mergeRegisterDefines(
  ...defineSets: readonly Readonly<Record<string, string>>[]
): Readonly<Record<string, string>> {
  const merged: Record<string, string> = {};
  for (const defines of defineSets) {
    Object.assign(merged, defines);
  }
  return merged;
}
