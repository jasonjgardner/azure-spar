import type { InputVariant } from "./types.ts";
import {
  stripComments,
  preprocessShader,
  postprocessShader,
} from "./processing.ts";
import { extractFunctions } from "./permutation.ts";
import { encodeShader, diffEncodedShader } from "./encoded-shader.ts";
import { groupShaderLines } from "./diffing.ts";
import {
  localFlagDefinitionFromGroupedShader,
  filterAndBiasFlags,
} from "./flag-definition.ts";
import { genAllFlagsList, assembleCode } from "./grouped-shader.ts";
import {
  extractSearchInputs,
  expressionSearch,
} from "./expression-search.ts";
import {
  processExpressions,
  markApproximatedResults,
} from "./expression-processing.ts";

export interface RestoreCodeOptions {
  readonly removeComments?: boolean;
  readonly processShaders?: boolean;
  readonly searchTimeout?: number;
}

export interface RestoreCodeResult {
  readonly usedMacros: ReadonlySet<string>;
  readonly code: string;
}

/**
 * Attempts to restore original shader source by combining variants
 * while adding missing macros.
 */
export function restoreCode(
  inputVariants: readonly InputVariant[],
  options: RestoreCodeOptions = {},
): RestoreCodeResult {
  const {
    removeComments = true,
    processShaders = false,
    searchTimeout = 10_000,
  } = options;

  // Build shader permutations
  const shaderPermutations = inputVariants.map((variant) => {
    let code = variant.code;

    if (removeComments) {
      code = stripComments(code);
    }
    if (processShaders) {
      code = preprocessShader(code);
    }

    return extractFunctions(code, { ...variant.flags });
  });

  // Encode, diff, and group
  const encodedShader = encodeShader(shaderPermutations);
  const diffedShader = diffEncodedShader(encodedShader);
  const groupedShader = groupShaderLines(diffedShader);

  // Build flag definitions and filter
  const localFlagDef = filterAndBiasFlags(
    localFlagDefinitionFromGroupedShader(groupedShader),
  );
  const allFlags = genAllFlagsList(groupedShader);

  // Extract expression search inputs (and update shader with indices)
  const { searchInputs, updatedShader } = extractSearchInputs(
    groupedShader,
    localFlagDef,
    allFlags,
  );

  // Search for boolean expressions
  const searchResults = expressionSearch(searchInputs, searchTimeout);

  // Convert to macro conditionals
  const { macroConditionals, macros: usedMacros } =
    processExpressions(searchResults);

  // Mark approximated results
  const finalMacros = markApproximatedResults(
    macroConditionals,
    searchResults,
    searchInputs,
  );

  // Assemble code
  let code = assembleCode(
    updatedShader,
    finalMacros,
    encodedShader.lineDecodeTable as string[],
  );

  if (processShaders) {
    code = postprocessShader(code);
  }

  return { usedMacros, code };
}
