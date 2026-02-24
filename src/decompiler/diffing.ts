import {
  type CodeLineGroup,
  type GroupedShader,
  createCodeLineGroup,
} from "./grouped-shader.ts";
import type { EncodedUniquifiedPermutations } from "./permutation.ts";
import type { FunctionName, ShaderFlags, ShaderLineIndex } from "../types.ts";

// ── Myers Diff ──────────────────────────────────────────────────

export type DiffOp = "k" | "i" | "r";
export type DiffEntry = readonly [DiffOp, number];

/**
 * Custom Myers diff on integer arrays.
 * Returns a list of (op, value) entries where:
 *  - 'k' = keep (in both old and new)
 *  - 'i' = insert (only in new)
 *  - 'r' = remove (only in old)
 */
export function myersDiff(
  oldArr: readonly number[],
  newArr: readonly number[],
): DiffEntry[] {
  const n = oldArr.length;
  const m = newArr.length;
  const max = n + m;

  if (n === 0 && m === 0) return [];
  if (n === 0) return newArr.map((v): DiffEntry => ["i", v]);
  if (m === 0) return oldArr.map((v): DiffEntry => ["r", v]);

  const offset = max;
  const vSize = 2 * max + 1;

  const trace: Int32Array[] = [];
  const v = new Int32Array(vSize);
  v[offset + 1] = 0;

  let found = false;
  for (let d = 0; d <= max && !found; d++) {
    trace.push(v.slice());

    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!)) {
        x = v[offset + k + 1]!;
      } else {
        x = v[offset + k - 1]! + 1;
      }

      let y = x - k;

      while (x < n && y < m && oldArr[x] === newArr[y]) {
        x++;
        y++;
      }

      v[offset + k] = x;

      if (x >= n && y >= m) {
        found = true;
        break;
      }
    }
  }

  // Backtrack to produce edit script
  let x = n;
  let y = m;
  const ops: DiffEntry[] = [];

  for (let d = trace.length - 1; d >= 0; d--) {
    const tv = trace[d]!;
    const k = x - y;

    let prevK: number;
    if (k === -d || (k !== d && tv[offset + k - 1]! < tv[offset + k + 1]!)) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }

    const prevX = tv[offset + prevK]!;
    const prevY = prevX - prevK;

    while (x > prevX && y > prevY) {
      x--;
      y--;
      ops.push(["k", oldArr[x]!]);
    }

    if (d > 0) {
      if (x === prevX) {
        y--;
        ops.push(["i", newArr[y]!]);
      } else {
        x--;
        ops.push(["r", oldArr[x]!]);
      }
    }
  }

  ops.reverse();
  return ops;
}

// ── Diffed Code ─────────────────────────────────────────────────

export interface DiffedCode {
  readonly lines: readonly ShaderLineIndex[];
  readonly lineConditions: readonly (readonly ShaderFlags[])[];
}

export function createDiffedCode(): DiffedCode {
  return { lines: [], lineConditions: [] };
}

/**
 * Groups consecutive lines with identical conditions into CodeLineGroup objects.
 */
export function groupLines(diffed: DiffedCode): readonly CodeLineGroup[] {
  if (diffed.lines.length === 0) return [];

  const groups: CodeLineGroup[] = [];
  let currentLines: ShaderLineIndex[] = [diffed.lines[0]!];
  let currentCondition = diffed.lineConditions[0]!;

  for (let i = 1; i < diffed.lines.length; i++) {
    const condition = diffed.lineConditions[i]!;

    if (JSON.stringify(condition) !== JSON.stringify(currentCondition)) {
      groups.push(createCodeLineGroup(currentLines, currentCondition));
      currentLines = [];
      currentCondition = condition;
    }

    currentLines.push(diffed.lines[i]!);
  }

  groups.push(createCodeLineGroup(currentLines, currentCondition));
  return groups;
}

// ── Diffed Shader ───────────────────────────────────────────────

export interface DiffedShader {
  readonly mainCode: DiffedCode;
  readonly functions: Readonly<Record<FunctionName, DiffedCode>>;
}

export function createDiffedShader(): DiffedShader {
  return { mainCode: createDiffedCode(), functions: {} };
}

/**
 * Groups lines in a DiffedShader into a GroupedShader.
 */
export function groupShaderLines(shader: DiffedShader): GroupedShader {
  const mainCode = groupLines(shader.mainCode);
  const functions: Record<FunctionName, readonly CodeLineGroup[]> = {};

  for (const [funcName, func] of Object.entries(shader.functions)) {
    functions[funcName] = groupLines(func);
  }

  return { mainCode, functions };
}

// ── Diff Permutations ───────────────────────────────────────────

/**
 * Combines (by diffing) permutations of code together into one DiffedCode object.
 * Each permutation is merged into the accumulator using Myers diff, tracking
 * which flag combinations apply to each line.
 */
export function diffPermutations(
  encodedPermutations: EncodedUniquifiedPermutations,
): DiffedCode {
  let lines: ShaderLineIndex[] = [];
  let lineConditions: (readonly ShaderFlags[])[] = [];

  for (let p = 0; p < encodedPermutations.codes.length; p++) {
    const code = encodedPermutations.codes[p]!;
    const flagList = encodedPermutations.flags[p]!;

    const diff = myersDiff(lines, code as number[]);

    const newLines: ShaderLineIndex[] = [];
    const newConditions: (readonly ShaderFlags[])[] = [];
    let currentIndex = 0;

    for (const [op, val] of diff) {
      newLines.push(val);

      if (op === "i") {
        newConditions.push([...flagList]);
      } else if (op === "r") {
        newConditions.push(lineConditions[currentIndex]!);
        currentIndex++;
      } else {
        // 'k' — merge old conditions with new flag list
        const merged = [...lineConditions[currentIndex]!, ...flagList];
        newConditions.push(merged);
        currentIndex++;
      }
    }

    lines = newLines;
    lineConditions = newConditions;
  }

  return { lines, lineConditions };
}
