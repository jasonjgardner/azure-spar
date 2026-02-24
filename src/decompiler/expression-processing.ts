import { simplifyLogic } from "../boolean/simplify.ts";
import {
  formatDefinitionName,
  generateFlagNameMacro,
  generatePassNameMacro,
} from "../util.ts";
import {
  type ExpressionSearchToken,
  type ExpressionSearchOutput,
  type ExpressionSearchInput,
  JoinType,
} from "./expression-search.ts";

// ── Token → Macro Conversion ────────────────────────────────────

/**
 * Converts an expression search token to a GLSL preprocessor macro name.
 */
export function tokenToMacro(token: ExpressionSearchToken): string {
  if (token.flagName === "pass") {
    return generatePassNameMacro(token.flagValue);
  }

  if (token.flagName.startsWith("f_")) {
    const flagName = token.flagName.slice(2);
    return generateFlagNameMacro(flagName, token.flagValue);
  }

  return formatDefinitionName(token.flagName + token.flagValue);
}

// ── Expression Simplification ───────────────────────────────────

/**
 * Evaluates a token list against a macro variable assignment (truth table row).
 * Each macro is either "defined" (true) or "not defined" (false).
 */
function evaluateTokensWithMacros(
  tokens: readonly ExpressionSearchToken[],
  macroAssignment: ReadonlyMap<string, boolean>,
): boolean {
  for (let i = tokens.length - 1; i >= 0; i--) {
    const token = tokens[i]!;
    const macro = tokenToMacro(token);
    let tokenValue = macroAssignment.get(macro) ?? false;

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

/**
 * Builds a truth table for a token list and returns the minterms and variables.
 */
function buildTruthTable(
  tokens: readonly ExpressionSearchToken[],
): { variables: readonly string[]; minterms: readonly number[] } {
  // Extract unique macro names
  const macroSet = new Set<string>();
  for (const token of tokens) {
    macroSet.add(tokenToMacro(token));
  }
  const variables = [...macroSet].sort();
  const numVars = variables.length;

  if (numVars === 0) return { variables, minterms: [] };

  const minterms: number[] = [];
  for (let i = 0; i < (1 << numVars); i++) {
    const assignment = new Map<string, boolean>();
    for (let j = 0; j < numVars; j++) {
      assignment.set(variables[j]!, (i & (1 << (numVars - 1 - j))) !== 0);
    }
    if (evaluateTokensWithMacros(tokens, assignment)) {
      minterms.push(i);
    }
  }

  return { variables, minterms };
}

/**
 * Formats a simplified expression for GLSL preprocessor use.
 * Replaces ~ with !, | with ||, & with &&, and wraps variable names in defined().
 */
function formatExpression(expr: string): string {
  let result = expr
    .replace(/~/g, "!")
    .replace(/\|/g, "||")
    .replace(/&/g, "&&");
  result = result.replace(/(\w+)/g, "defined($1)");
  return result;
}

/**
 * Processes expression search results:
 * - Simplifies boolean expressions using Quine-McCluskey
 * - Converts simplified expressions into macro condition strings
 * - Returns macro conditionals and the set of referenced macros
 */
export function processExpressions(
  searchOutputs: readonly ExpressionSearchOutput[],
): {
  readonly macroConditionals: readonly string[];
  readonly macros: ReadonlySet<string>;
} {
  const allMacros = new Set<string>();
  const expressions: string[] = [];

  // Build unique expression cache for deduplication
  const uniqueCache = new Map<string, string>();

  for (const output of searchOutputs) {
    if (output.tokenList.length === 0) {
      expressions.push("#if 0");
      continue;
    }

    const { variables, minterms } = buildTruthTable(output.tokenList);

    // Create cache key from truth table
    const cacheKey = `${variables.join(",")}:${minterms.join(",")}`;
    const cached = uniqueCache.get(cacheKey);

    if (cached !== undefined) {
      expressions.push(cached);
      continue;
    }

    const simplified = simplifyLogic(variables, minterms);

    for (const atom of simplified.atoms) {
      allMacros.add(atom);
    }

    let macroConditional: string;

    if (simplified.atoms.size === 1) {
      const expr = simplified.expression;
      if (expr.startsWith("~")) {
        macroConditional = "#ifndef " + expr.slice(1);
      } else {
        macroConditional = "#ifdef " + expr;
      }
    } else {
      macroConditional = "#if " + formatExpression(simplified.expression);
    }

    uniqueCache.set(cacheKey, macroConditional);
    expressions.push(macroConditional);
  }

  return { macroConditionals: expressions, macros: allMacros };
}

/**
 * Adds `// Approximation, matches X cases out of Y` comment to
 * macro conditional expressions that don't exactly match all flag sets.
 */
export function markApproximatedResults(
  macroConditionals: readonly string[],
  searchResults: readonly ExpressionSearchOutput[],
  searchInputs: readonly ExpressionSearchInput[],
): readonly string[] {
  return macroConditionals.map((macro, i) => {
    const result = searchResults[i]!;
    const input = searchInputs[i]!;

    if (result.score !== input.flags.length) {
      return `// Approximation, matches ${result.score} cases out of ${input.flags.length}\n${macro}`;
    }

    return macro;
  });
}
