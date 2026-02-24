import type { FunctionName, ShaderFlags } from "../types.ts";

/**
 * Stores all permutations of flags separately for each context
 * (main code + individual functions).
 */
export interface AllFlags {
  readonly mainFlags: readonly ShaderFlags[];
  readonly functionFlags: Readonly<Record<FunctionName, readonly ShaderFlags[]>>;
}

export function createAllFlags(): AllFlags {
  return { mainFlags: [], functionFlags: {} };
}
