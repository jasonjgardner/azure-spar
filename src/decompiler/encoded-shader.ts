import { type DiffedShader, diffPermutations } from "./diffing.ts";
import type {
  ShaderPermutation,
  EncodedUniquifiedPermutations,
} from "./permutation.ts";
import type {
  ShaderCode,
  FunctionName,
  ShaderFlags,
  ShaderLine,
  ShaderLineIndex,
} from "../types.ts";

/**
 * A shader with each unique line of code replaced with a unique number.
 * Deduplicates identical permutation code and encodes lines to indices
 * shared across all permutations.
 */
export interface EncodedShader {
  readonly mainShader: EncodedUniquifiedPermutations;
  readonly functions: Readonly<Record<FunctionName, EncodedUniquifiedPermutations>>;
  readonly lineDecodeTable: readonly ShaderLine[];
}

/**
 * Encodes a list of shader permutations into an EncodedShader.
 * Deduplicates identical code variants, assigns each unique line a numeric index,
 * and produces encoded permutations for both the main shader body and all functions.
 */
export function encodeShader(
  permutations: readonly ShaderPermutation[],
): EncodedShader {
  const lineDecodeTable: ShaderLine[] = [];

  // Uniquify: group permutations by identical code, collecting their flags
  const uniquifiedMainShader = new Map<ShaderCode, ShaderFlags[]>();
  const uniquifiedFunctions = new Map<FunctionName, Map<ShaderCode, ShaderFlags[]>>();

  for (const permutation of permutations) {
    insertFlags(uniquifiedMainShader, permutation.code, permutation.flags);

    for (const [name, func] of Object.entries(permutation.functions)) {
      let funcCodeMap = uniquifiedFunctions.get(name);
      if (funcCodeMap === undefined) {
        funcCodeMap = new Map<ShaderCode, ShaderFlags[]>();
        uniquifiedFunctions.set(name, funcCodeMap);
      }
      insertFlags(funcCodeMap, func.code, func.flags);
    }
  }

  // Encode main shader
  const mainShader = encodePermutations(uniquifiedMainShader, lineDecodeTable);

  // Encode functions
  const functions: Record<FunctionName, EncodedUniquifiedPermutations> = {};
  for (const [funcName, table] of uniquifiedFunctions) {
    functions[funcName] = encodePermutations(table, lineDecodeTable);
  }

  return { mainShader, functions, lineDecodeTable };
}

/**
 * Diffs an encoded shader, combining code of all permutations.
 */
export function diffEncodedShader(shader: EncodedShader): DiffedShader {
  const mainCode = diffPermutations(shader.mainShader);
  const functions: Record<FunctionName, ReturnType<typeof diffPermutations>> = {};

  for (const [funcName, func] of Object.entries(shader.functions)) {
    functions[funcName] = diffPermutations(func);
  }

  return { mainCode, functions };
}

// ── Helpers ─────────────────────────────────────────────────────

function insertFlags(
  table: Map<ShaderCode, ShaderFlags[]>,
  code: ShaderCode,
  flags: ShaderFlags,
): void {
  const flagList = table.get(code);
  if (flagList === undefined) {
    table.set(code, [flags]);
    return;
  }
  flagList.push(flags);
}

function encodePermutations(
  table: Map<ShaderCode, ShaderFlags[]>,
  lineDecodeTable: ShaderLine[],
): EncodedUniquifiedPermutations {
  const codes: ShaderLineIndex[][] = [];
  const flags: ShaderFlags[][] = [];

  for (const [code, flagList] of table) {
    const encodedLines: ShaderLineIndex[] = [];

    for (const line of code.split("\n")) {
      let lineIndex = lineDecodeTable.indexOf(line);
      if (lineIndex === -1) {
        lineIndex = lineDecodeTable.length;
        lineDecodeTable.push(line);
      }
      encodedLines.push(lineIndex);
    }

    codes.push(encodedLines);
    flags.push(flagList);
  }

  return { codes, flags };
}
