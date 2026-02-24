import { formatFunctionName } from "./processing.ts";
import type { AllFlags } from "./all-flags.ts";
import type { ShaderLineIndex, ShaderFlags, FunctionName } from "../types.ts";

/**
 * A group of consecutive lines of code that share the same condition
 * (appear when the same flags are set).
 */
export interface CodeLineGroup {
  readonly lines: readonly ShaderLineIndex[];
  readonly condition: readonly ShaderFlags[];
  readonly expressionSearchIndex: number | null;
}

export function createCodeLineGroup(
  lines: readonly ShaderLineIndex[],
  condition: readonly ShaderFlags[],
  expressionSearchIndex: number | null = null,
): CodeLineGroup {
  return { lines, condition, expressionSearchIndex };
}

export interface GroupedShader {
  readonly mainCode: readonly CodeLineGroup[];
  readonly functions: Readonly<Record<FunctionName, readonly CodeLineGroup[]>>;
}

export function createGroupedShader(): GroupedShader {
  return { mainCode: [], functions: {} };
}

/**
 * Generates a list of all flags, per context (main code or individual functions).
 */
export function genAllFlagsList(shader: GroupedShader): AllFlags {
  const mainFlags = genFlagListFromLineGroups(shader.mainCode);
  const functionFlags: Record<FunctionName, readonly ShaderFlags[]> = {};

  for (const [functionName, functionLineGroups] of Object.entries(shader.functions)) {
    functionFlags[functionName] = genFlagListFromLineGroups(functionLineGroups);
  }

  return { mainFlags, functionFlags };
}

function genFlagListFromLineGroups(
  codeLineGroups: readonly CodeLineGroup[],
): readonly ShaderFlags[] {
  const flagList: ShaderFlags[] = [];

  for (const lineGroup of codeLineGroups) {
    for (const flags of lineGroup.condition) {
      const alreadyExists = flagList.some(
        (existing) => JSON.stringify(existing) === JSON.stringify(flags),
      );
      if (!alreadyExists) {
        flagList.push(flags);
      }
    }
  }

  return flagList;
}

/**
 * Assembles a single code line group back into source code.
 */
export function assembleLineGroup(
  group: CodeLineGroup,
  lineDecodeTable: readonly string[],
  macroExpressions: readonly string[],
): string {
  const code = group.lines.map((i) => lineDecodeTable[i]!).join("\n");
  if (group.expressionSearchIndex !== null) {
    return `${macroExpressions[group.expressionSearchIndex]}\n${code}\n#endif`;
  }
  return code;
}

/**
 * Assembles a list of code line groups into source code.
 */
export function assembleLineGroups(
  code: readonly CodeLineGroup[],
  lineDecodeTable: readonly string[],
  macroExpressions: readonly string[],
): string {
  return code
    .map((group) => assembleLineGroup(group, lineDecodeTable, macroExpressions))
    .join("\n");
}

/**
 * Assembles the full shader back into its source code form,
 * reinserting function and struct bodies.
 */
export function assembleCode(
  shader: GroupedShader,
  macroExpressions: readonly string[],
  lineDecodeTable: readonly string[],
): string {
  let shaderCode = assembleLineGroups(shader.mainCode, lineDecodeTable, macroExpressions);

  for (const [funcName, funcBody] of Object.entries(shader.functions)) {
    let body = assembleLineGroups(funcBody, lineDecodeTable, macroExpressions);

    if (!body.startsWith("\n")) body = "\n" + body;
    if (!body.endsWith("\n")) body = body + "\n";

    const isStruct = funcName.startsWith("struct ");
    const replacement = `${funcName} {${body}}${isStruct ? ";" : ""}`;
    shaderCode = shaderCode.replace(formatFunctionName(funcName), replacement);
  }

  return shaderCode;
}
