import type { ShaderInput } from "../material/shader-input.ts";
import {
  ShaderStage,
  ShaderPlatform,
  SHADER_PLATFORM_NAMES,
  Precision,
  PRECISION_NAMES,
  Interpolation,
  INTERPOLATION_NAMES,
  INPUT_TYPE_NAMES,
  getSemanticName,
  getSemanticVariableName,
} from "../material/enums.ts";
import { generateFlagNameMacro } from "../util.ts";
import type { InputVariant } from "./types.ts";
import { restoreCode } from "./decompiler.ts";

/**
 * Creates a text line from varying.def.sc for a specific shader input and stage.
 */
export function generateVaryingLine(
  shaderInput: ShaderInput,
  stage: ShaderStage,
): { isInstanceData: boolean; line: string } {
  let line = "";
  let isInstanceData = false;

  if (shaderInput.precision !== Precision.None) {
    line += PRECISION_NAMES[shaderInput.precision] + " ";
  }
  if (shaderInput.interpolation !== Interpolation.None) {
    line += INTERPOLATION_NAMES[shaderInput.interpolation] + " ";
  }
  line += INPUT_TYPE_NAMES[shaderInput.type] + " ";

  let name = shaderInput.name;
  if (name.startsWith("instanceData")) {
    const num = parseInt(name.slice("instanceData".length), 10);
    name = `i_data${num + 1}`;
    isInstanceData = true;
  } else if (stage === ShaderStage.Vertex) {
    name = "a_" + getSemanticVariableName(shaderInput.semantic);
  } else {
    name = "v_" + name;
  }

  line += `${name} : ${getSemanticName(shaderInput.semantic)};`;

  return { isInstanceData, line };
}

// ── Postprocess Varying ─────────────────────────────────────────

function alignVaryingLines(code: string, prefix: string): string {
  const pattern = new RegExp(`^(.+? )(${prefix}\\w+)([\\s]+: [\\w]+;)`, "gm");
  const matches = [...code.matchAll(pattern)];

  if (matches.length === 0) return code;

  const maxTypeLen = Math.max(...matches.map((m) => m[1]!.length));
  const maxNameLen = Math.max(...matches.map((m) => m[2]!.length));

  return code.replace(pattern, (_match, type: string, name: string, rest: string) => {
    return type.padEnd(maxTypeLen) + name.padEnd(maxNameLen) + rest;
  });
}

/**
 * Formats generated varying.def code and corrects platform macros.
 */
function postprocessVarying(code: string): string {
  let result = code;

  // Align columns for each varying prefix
  for (const prefix of ["a_", "i_", "v_"]) {
    result = alignVaryingLines(result, prefix);
  }

  // Replace platform flag macros with BGFX shader language comparisons
  for (const platform of Object.values(ShaderPlatform).filter(
    (v): v is ShaderPlatform => typeof v === "number",
  )) {
    const platformName = SHADER_PLATFORM_NAMES[platform];
    if (!platformName) continue;

    let lang = "UNKNOWN";
    let version = 1;

    if (platformName.startsWith("Direct3D_")) {
      lang = "HLSL";
      if (platform === ShaderPlatform.Direct3D_SM40) {
        version = 400;
      } else if (platformName.startsWith("Direct3D_SM")) {
        version = 500;
      }
    } else if (
      platformName.startsWith("GLSL_") ||
      platformName.startsWith("ESSL_")
    ) {
      lang = "GLSL";
      version = parseInt(platformName.slice(-3), 10);
    } else if (platform === ShaderPlatform.Vulkan) {
      lang = "SPIRV";
    } else if (platform === ShaderPlatform.Nvn) {
      // Don't know what should be used here
    } else {
      lang = platformName.toUpperCase();
    }

    const bgfxLang = `BGFX_SHADER_LANGUAGE_${lang}`;
    const macro = generateFlagNameMacro("platform", platformName);

    result = result
      .replace(
        new RegExp(`defined\\(${macro}\\)`, "g"),
        `(${bgfxLang} == ${version})`,
      )
      .replace(
        new RegExp(`#ifdef ${macro}`, "g"),
        `#if ${bgfxLang} == ${version}`,
      )
      .replace(
        new RegExp(`#ifndef ${macro}`, "g"),
        `#if ${bgfxLang} != ${version}`,
      );
  }

  return result;
}

/**
 * Restores the varying.def.sc file from shader permutations.
 */
export function restoreVarying(
  permutations: readonly InputVariant[],
  searchTimeout: number = 10_000,
): string {
  const { code } = restoreCode(permutations, {
    removeComments: false,
    searchTimeout,
  });

  return postprocessVarying(code);
}
