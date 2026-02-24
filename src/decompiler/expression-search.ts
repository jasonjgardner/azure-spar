import {
  type CodeLineGroup,
  type GroupedShader,
  createCodeLineGroup,
} from "./grouped-shader.ts";
import type { LocalFlagDefinition } from "./flag-definition.ts";
import type { AllFlags } from "./all-flags.ts";
import type {
  ShaderFlags,
  FlagDefinition,
  FlagName,
  FlagValue,
} from "../types.ts";

// ── Types ───────────────────────────────────────────────────────

export enum JoinType {
  Or,
  And,
  Initial,
}

export interface ExpressionSearchToken {
  readonly joinType: JoinType;
  readonly isNegative: boolean;
  readonly flagName: FlagName;
  readonly flagValue: FlagValue;
}

export interface ExpressionSearchInput {
  readonly flags: readonly [boolean, ShaderFlags][];
  readonly flagDefinition: FlagDefinition;
}

export interface ExpressionSearchOutput {
  readonly tokenList: readonly ExpressionSearchToken[];
  readonly score: number;
}

// ── Expression Evaluation ───────────────────────────────────────

/**
 * Evaluates expression token sequence for a given set of flags.
 * Evaluation is in reverse order for short-circuiting.
 */
export function evaluateExpression(
  tokenList: readonly ExpressionSearchToken[],
  flags: ShaderFlags,
): boolean {
  for (let i = tokenList.length - 1; i >= 0; i--) {
    const token = tokenList[i]!;
    let tokenValue = flags[token.flagName] === token.flagValue;

    if (token.isNegative) {
      tokenValue = !tokenValue;
    }

    if (token.joinType === JoinType.And) {
      if (!tokenValue) return false;
    } else if (token.joinType === JoinType.Or) {
      if (tokenValue) return true;
    } else {
      return tokenValue;
    }
  }

  return false;
}

function calcScore(
  tokenList: readonly ExpressionSearchToken[],
  flagOutcomes: readonly [boolean, ShaderFlags][],
): number {
  let score = 0;
  for (const [outcome, flags] of flagOutcomes) {
    if (evaluateExpression(tokenList, flags) === outcome) {
      score++;
    }
  }
  return score;
}

// ── Fast Search ─────────────────────────────────────────────────

/**
 * Greedy search: tests one token at a time, finding the configuration
 * that yields the highest score, then moves on. Linear complexity in
 * token sequence length but not guaranteed to find an exact solution.
 */
function fastSearch(
  input: ExpressionSearchInput,
): ExpressionSearchOutput {
  let bestExpression: ExpressionSearchToken[] = [];
  let bestExpressionScore = 0;

  const currentExpression: ExpressionSearchToken[] = [];
  const maxIterations = Object.keys(input.flagDefinition).length + 5;

  for (let iter = 0; iter < maxIterations; iter++) {
    let bestToken: ExpressionSearchToken = {
      joinType: JoinType.Initial,
      isNegative: false,
      flagName: "",
      flagValue: "",
    };
    let bestTokenScore = 0;

    const joinList: JoinType[] =
      currentExpression.length === 0
        ? [JoinType.Initial]
        : [JoinType.Or, JoinType.And];

    for (const isNegative of [false, true]) {
      for (const joinType of joinList) {
        for (const [flagName, flagValues] of Object.entries(input.flagDefinition)) {
          for (const flagValue of flagValues) {
            const candidate: ExpressionSearchToken = {
              joinType,
              isNegative,
              flagName,
              flagValue,
            };

            const testExpr = [...currentExpression, candidate];
            const score = calcScore(testExpr, input.flags);

            if (score > bestTokenScore) {
              bestTokenScore = score;
              bestToken = candidate;
            }
          }
        }
      }
    }

    currentExpression.push(bestToken);

    if (bestTokenScore > bestExpressionScore) {
      bestExpressionScore = bestTokenScore;
      bestExpression = [...currentExpression];
    }

    if (bestExpressionScore >= input.flags.length) break;
  }

  return { tokenList: bestExpression, score: bestExpressionScore };
}

// ── Slow Search (Brute Force) ───────────────────────────────────

/**
 * Mutates an expression to cycle through all possible token sequences.
 * Returns false when a new token was appended (expression grew).
 */
function incrementExpression(
  expression: MutableToken[],
  flagDef: FlagDefinition,
): void {
  const flagNames = Object.keys(flagDef);

  for (const token of expression) {
    // Increment flag value
    const flagValueList = flagDef[token.flagName]!;
    const newValueIndex = flagValueList.indexOf(token.flagValue) + 1;

    if (newValueIndex < flagValueList.length) {
      token.flagValue = flagValueList[newValueIndex]!;
      return;
    }

    // Increment flag name
    const newNameIndex = flagNames.indexOf(token.flagName) + 1;

    if (newNameIndex < flagNames.length) {
      token.flagName = flagNames[newNameIndex]!;
      token.flagValue = flagDef[token.flagName]![0]!;
      return;
    }

    token.flagName = flagNames[0]!;
    token.flagValue = flagDef[token.flagName]![0]!;

    // Increment join type
    if (token.joinType !== JoinType.Initial) {
      if (token.joinType === JoinType.Or) {
        token.joinType = JoinType.And;
        return;
      }
      token.joinType = JoinType.Or;
    }

    // Increment is_negative
    if (!token.isNegative) {
      token.isNegative = true;
      return;
    }
    token.isNegative = false;
  }

  // All values exhausted — append new token
  const initialFlagName = flagNames[0]!;
  expression.push({
    joinType: expression.length === 0 ? JoinType.Initial : JoinType.Or,
    isNegative: false,
    flagName: initialFlagName,
    flagValue: flagDef[initialFlagName]![0]!,
  });
}

interface MutableToken {
  joinType: JoinType;
  isNegative: boolean;
  flagName: FlagName;
  flagValue: FlagValue;
}

/**
 * Brute-force search: checks every possible combination of tokens.
 * Guaranteed to find the exact solution given enough time.
 */
function slowSearch(
  input: ExpressionSearchInput,
  timeout: number = 10_000,
): ExpressionSearchOutput {
  let bestExpression: ExpressionSearchToken[] = [];
  let bestExpressionScore = 0;

  const currentExpression: MutableToken[] = [];
  const startTime = performance.now();

  while (true) {
    const score = calcScore(currentExpression, input.flags);

    if (score > bestExpressionScore) {
      bestExpressionScore = score;
      bestExpression = currentExpression.map((t) => ({ ...t }));
    }

    if (
      bestExpressionScore === input.flags.length ||
      performance.now() - startTime >= timeout
    ) {
      break;
    }

    incrementExpression(currentExpression, input.flagDefinition);
  }

  return { tokenList: bestExpression, score: bestExpressionScore };
}

// ── Main Entry Point ────────────────────────────────────────────

/**
 * Applies search algorithms to find boolean expressions that correctly
 * match all sets of flags. Uses fast search first, then falls back to
 * slow (brute-force) search if fast search doesn't find an exact solution.
 */
export function expressionSearch(
  inputs: readonly ExpressionSearchInput[],
  timeout: number = 10_000,
): readonly ExpressionSearchOutput[] {
  return inputs.map((input) => {
    const fastResult = fastSearch(input);

    if (fastResult.score >= input.flags.length) {
      return fastResult;
    }

    const slowResult = slowSearch(input, timeout);

    if (
      slowResult.score > fastResult.score ||
      (slowResult.score === fastResult.score &&
        slowResult.tokenList.length < fastResult.tokenList.length)
    ) {
      return slowResult;
    }

    return fastResult;
  });
}

// ── Extract Search Inputs from Grouped Shader ───────────────────

function shaderFlagsEqual(a: ShaderFlags, b: ShaderFlags): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((k) => a[k] === b[k]);
}

function searchInputsEqual(
  a: ExpressionSearchInput,
  b: ExpressionSearchInput,
): boolean {
  if (a.flags.length !== b.flags.length) return false;
  for (let i = 0; i < a.flags.length; i++) {
    if (a.flags[i]![0] !== b.flags[i]![0]) return false;
    if (!shaderFlagsEqual(a.flags[i]![1], b.flags[i]![1])) return false;
  }
  return JSON.stringify(a.flagDefinition) === JSON.stringify(b.flagDefinition);
}

function extractFromLineGroups(
  codeLineGroups: readonly CodeLineGroup[],
  allFlags: readonly ShaderFlags[],
  flagDef: FlagDefinition,
  searchInputList: ExpressionSearchInput[],
): readonly CodeLineGroup[] {
  return codeLineGroups.map((lineGroup) => {
    if (lineGroup.condition.length === allFlags.length) {
      return lineGroup;
    }

    const flags: [boolean, ShaderFlags][] = allFlags.map((f) => [
      lineGroup.condition.some((c) => shaderFlagsEqual(c, f)),
      f,
    ]);

    const searchInput: ExpressionSearchInput = {
      flags,
      flagDefinition: flagDef,
    };

    let index = searchInputList.findIndex((existing) =>
      searchInputsEqual(existing, searchInput),
    );

    if (index === -1) {
      index = searchInputList.length;
      searchInputList.push(searchInput);
    }

    return createCodeLineGroup(
      lineGroup.lines,
      lineGroup.condition,
      index,
    );
  });
}

/**
 * Extracts expression search inputs from a grouped shader and returns
 * both the inputs and an updated shader with expressionSearchIndex set.
 */
export function extractSearchInputs(
  shader: GroupedShader,
  flagDef: LocalFlagDefinition,
  allFlags: AllFlags,
): {
  readonly searchInputs: readonly ExpressionSearchInput[];
  readonly updatedShader: GroupedShader;
} {
  const searchInputs: ExpressionSearchInput[] = [];

  const updatedMainCode = extractFromLineGroups(
    shader.mainCode,
    allFlags.mainFlags,
    flagDef.mainShader,
    searchInputs,
  );

  const updatedFunctions: Record<string, readonly CodeLineGroup[]> = {};
  for (const [funcName, funcBody] of Object.entries(shader.functions)) {
    updatedFunctions[funcName] = extractFromLineGroups(
      funcBody,
      allFlags.functionFlags[funcName] ?? [],
      flagDef.functions[funcName] ?? {},
      searchInputs,
    );
  }

  return {
    searchInputs,
    updatedShader: { mainCode: updatedMainCode, functions: updatedFunctions },
  };
}
