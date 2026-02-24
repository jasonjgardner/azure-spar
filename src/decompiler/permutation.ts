import { formatFunctionName } from "./processing.ts";
import type {
  ShaderCode,
  FunctionName,
  ShaderFlags,
  ShaderLineIndex,
} from "../types.ts";

export interface FunctionPermutation {
  readonly code: ShaderCode;
  readonly flags: ShaderFlags;
  readonly isStruct: boolean;
}

export interface ShaderPermutation {
  readonly code: ShaderCode;
  readonly flags: ShaderFlags;
  readonly functions: Readonly<Record<FunctionName, FunctionPermutation>>;
}

export interface EncodedUniquifiedPermutations {
  readonly codes: readonly (readonly ShaderLineIndex[])[];
  readonly flags: readonly (readonly ShaderFlags[])[];
}

export function createEncodedUniquifiedPermutations(): EncodedUniquifiedPermutations {
  return { codes: [], flags: [] };
}

const RE_FUNC_START = /^[\s]*?([^#\s][\w]+)[\s]+([\w]+)[\s]*\(([^;]*?)\)[\s]*\{/ms;
const RE_STRUCT_START = /^[\s]*?struct[\s]+([\w]+)[\s]*\{(.*?)\};/gms;

/**
 * Extracts functions and structs from shader permutation code,
 * replacing their bodies with format name placeholders.
 */
export function extractFunctions(
  inputCode: ShaderCode,
  flags: ShaderFlags,
): ShaderPermutation {
  const functions: Record<FunctionName, FunctionPermutation> = {};
  let code = inputCode;
  let modifiedCode = "";

  // Extract functions
  let funcMatch = RE_FUNC_START.exec(code);
  while (funcMatch) {
    const [, returnType, funcName, rawArgs] = funcMatch;
    const args = rawArgs!.replace(/\n/g, "");
    const fullFuncName = `${returnType} ${funcName}(${args})`;

    modifiedCode += code.slice(0, funcMatch.index);

    let bracketBalance = 1;
    let funcEnd = -1;
    for (let i = funcMatch.index + funcMatch[0].length; i < code.length; i++) {
      const c = code[i];
      if (c === "{") bracketBalance++;
      if (c === "}") bracketBalance--;

      if (bracketBalance === 0) {
        const funcContent = code.slice(funcMatch.index + funcMatch[0].length, i);
        code = code.slice(i + 1);
        funcEnd = i;

        functions[fullFuncName] = {
          code: funcContent,
          flags,
          isStruct: false,
        };
        break;
      }
    }

    if (funcEnd === -1) break;

    modifiedCode += formatFunctionName(fullFuncName) + "\n";

    // Reset regex for next search on remaining code
    RE_FUNC_START.lastIndex = 0;
    funcMatch = RE_FUNC_START.exec(code);
  }

  code = modifiedCode + code;

  // Extract structs
  RE_STRUCT_START.lastIndex = 0;
  const structMatches = [...code.matchAll(RE_STRUCT_START)];
  for (const match of structMatches) {
    const [fullMatch, structName, structContent] = match;
    const fullStructName = `struct ${structName}`;

    functions[fullStructName] = {
      code: structContent!,
      flags,
      isStruct: true,
    };

    code = code.replace(fullMatch!, formatFunctionName(fullStructName) + "\n");
  }

  return { code, flags, functions };
}
