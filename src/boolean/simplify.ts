/**
 * Quine-McCluskey boolean minimization.
 * Replaces sympy.simplify_logic — only needs AND, OR, NOT on boolean variables.
 *
 * Uses numpy-ts for vectorized pairwise implicant comparison via broadcasting,
 * replacing the O(n²) scalar inner loop with batch ndarray operations.
 */

import {
  array,
  reshape,
  bitwise_xor,
  bitwise_and,
  subtract,
  not_equal,
  equal,
  logical_and,
  nonzero,
  triu,
} from "numpy-ts/core";

export interface SimplifiedExpression {
  /** Expression in "A & B | ~C" format (sympy-style) */
  readonly expression: string;
  /** Variable names used in the simplified expression */
  readonly atoms: ReadonlySet<string>;
}

interface Implicant {
  readonly mask: number;
  readonly value: number;
  readonly minterms: ReadonlySet<number>;
}

/**
 * Simplifies a boolean function given its variables and minterms.
 * Uses the Quine-McCluskey algorithm to find the minimal Sum-of-Products form.
 *
 * @param variables - Ordered list of variable names (MSB first in minterm encoding)
 * @param minterms - List of minterm indices where the function evaluates to true
 */
export function simplifyLogic(
  variables: readonly string[],
  minterms: readonly number[],
): SimplifiedExpression {
  const numVars = variables.length;

  if (minterms.length === 0) {
    return { expression: "False", atoms: new Set() };
  }

  if (minterms.length === (1 << numVars)) {
    return { expression: "True", atoms: new Set() };
  }

  const primeImplicants = findPrimeImplicants(minterms, numVars);
  const cover = findMinimalCover(primeImplicants, minterms);
  return formatImplicants(cover, variables);
}

// ── Quine-McCluskey Core ────────────────────────────────────────

/**
 * Groups implicants by mask value, then uses numpy-ts broadcasting
 * to compute all pairwise XOR differences within each group at once.
 * Valid pairs (differing in exactly one masked bit) are extracted
 * from the upper triangle of the result matrix.
 */
function findPrimeImplicants(
  minterms: readonly number[],
  numVars: number,
): readonly Implicant[] {
  let implicants: Implicant[] = minterms.map((m) => ({
    mask: (1 << numVars) - 1,
    value: m,
    minterms: new Set([m]),
  }));

  const primeImplicants: Implicant[] = [];

  while (implicants.length > 0) {
    // Group implicants by mask value for vectorized comparison
    const maskGroups = new Map<number, number[]>();
    for (let i = 0; i < implicants.length; i++) {
      const mask = implicants[i]!.mask;
      const group = maskGroups.get(mask);
      if (group === undefined) {
        maskGroups.set(mask, [i]);
        continue;
      }
      group.push(i);
    }

    const used = new Set<number>();
    const newImplicants: Implicant[] = [];
    const seen = new Set<string>();

    for (const [mask, groupIndices] of maskGroups) {
      if (groupIndices.length < 2) continue;

      // Build value array for this mask group
      const values = array(
        groupIndices.map((idx) => implicants[idx]!.value),
        "int32",
      );

      // Vectorized pairwise XOR via broadcasting: [n,1] XOR [1,n] → [n,n]
      const col = reshape(values, [-1, 1]);
      const row = reshape(values, [1, -1]);
      const diffs = bitwise_xor(col, row);

      // Batch check: diff != 0, exactly one bit set, and bit is in mask
      const nonZero = not_equal(diffs, 0);
      const oneBit = equal(bitwise_and(diffs, subtract(diffs, 1)), 0);
      const inMask = not_equal(bitwise_and(diffs, mask), 0);
      const validPairs = triu(logical_and(logical_and(nonZero, oneBit), inMask), 1);

      // Extract valid pair indices from upper triangle
      const pairIndices = nonzero(validPairs);
      const rowList = pairIndices[0]!.tolist() as number[];
      const colList = pairIndices[1]!.tolist() as number[];

      for (let p = 0; p < rowList.length; p++) {
        const localI = rowList[p]!;
        const localJ = colList[p]!;
        const origI = groupIndices[localI]!;
        const origJ = groupIndices[localJ]!;
        const a = implicants[origI]!;
        const b = implicants[origJ]!;
        const diff = a.value ^ b.value;

        const newMask = mask & ~diff;
        const newValue = a.value & newMask;
        const key = `${newMask}:${newValue}`;

        if (!seen.has(key)) {
          seen.add(key);
          newImplicants.push({
            mask: newMask,
            value: newValue,
            minterms: new Set([...a.minterms, ...b.minterms]),
          });
        }

        used.add(origI);
        used.add(origJ);
      }
    }

    for (let i = 0; i < implicants.length; i++) {
      if (!used.has(i)) {
        primeImplicants.push(implicants[i]!);
      }
    }

    implicants = newImplicants;
  }

  return primeImplicants;
}

function findMinimalCover(
  primeImplicants: readonly Implicant[],
  minterms: readonly number[],
): readonly Implicant[] {
  const uncovered = new Set(minterms);
  const selected: Implicant[] = [];

  // Essential prime implicants: those that are the only cover for some minterm
  for (const minterm of minterms) {
    const covering = primeImplicants.filter((pi) => pi.minterms.has(minterm));
    if (covering.length === 1 && !selected.includes(covering[0]!)) {
      selected.push(covering[0]!);
      for (const m of covering[0]!.minterms) {
        uncovered.delete(m);
      }
    }
  }

  // Greedy cover for remaining
  while (uncovered.size > 0) {
    let bestPI: Implicant | null = null;
    let bestCoverage = 0;

    for (const pi of primeImplicants) {
      if (selected.includes(pi)) continue;
      let coverage = 0;
      for (const m of pi.minterms) {
        if (uncovered.has(m)) coverage++;
      }
      if (coverage > bestCoverage) {
        bestCoverage = coverage;
        bestPI = pi;
      }
    }

    if (bestPI === null) break;

    selected.push(bestPI);
    for (const m of bestPI.minterms) {
      uncovered.delete(m);
    }
  }

  return selected;
}

// ── Formatting ──────────────────────────────────────────────────

function formatImplicants(
  implicants: readonly Implicant[],
  variables: readonly string[],
): SimplifiedExpression {
  const atoms = new Set<string>();
  const numVars = variables.length;

  const products = implicants.map((impl) => {
    const literals: string[] = [];

    for (let i = 0; i < numVars; i++) {
      const bit = 1 << (numVars - 1 - i);
      if ((impl.mask & bit) === 0) continue; // don't-care

      const varName = variables[i]!;
      atoms.add(varName);

      literals.push((impl.value & bit) ? varName : `~${varName}`);
    }

    return literals.length > 0 ? literals.join(" & ") : "True";
  });

  if (products.length === 0) {
    return { expression: "False", atoms };
  }

  // Single product with single literal — no need for parens
  if (products.length === 1) {
    return { expression: products[0]!, atoms };
  }

  // Multiple products — join with OR
  // Wrap multi-literal products in parens only if there are multiple products
  const formatted = products.map((p) => {
    if (p.includes(" & ") && products.length > 1) return `(${p})`;
    return p;
  });

  return { expression: formatted.join(" | "), atoms };
}
