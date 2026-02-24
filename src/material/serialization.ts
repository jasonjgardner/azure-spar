import type { Material } from "./material.ts";
import { JSON_FORMAT_VERSION, createMaterial } from "./material.ts";
import { type ShaderInput, shaderInputsEqual, serializeShaderInputMinimal, loadShaderInputMinimal } from "./shader-input.ts";
import { serializeBufferMinimal, loadBufferMinimal } from "./buffer.ts";
import { serializeUniformMinimal, loadUniformMinimal } from "./uniform.ts";
import { serializePassMinimal, loadPassMinimal } from "./pass.ts";
import { getMaterialFlagDefinitions } from "./material.ts";
import type { InputVariant } from "../decompiler/types.ts";
import { ShaderPlatform, ShaderStage, SHADER_PLATFORM_NAMES, SHADER_STAGE_NAMES } from "./enums.ts";
import { restoreCode, type RestoreCodeOptions } from "../decompiler/decompiler.ts";
import { restoreVarying, generateVaryingLine } from "../decompiler/varying.ts";
import { generateFlagNameMacro, generatePassNameMacro, insertHeaderComment } from "../util.ts";

const TEXT_DECODER = new TextDecoder("utf-8");

// ── Material Properties Serialization ───────────────────────────

/**
 * Returns a dictionary with encoded material properties (human-readable JSON).
 */
export function serializeMaterialProperties(
  material: Material,
): Record<string, unknown> {
  return {
    version: material.version,
    name: material.name,
    parent: material.parent,
    buffers: material.buffers.map((b) => b.name),
    uniforms: material.uniforms.map((u) => u.name),
    uniform_overrides: { ...material.uniformOverrides },
    passes: material.passes.map((p) => p.name),
  };
}

// ── Minimal JSON Format ─────────────────────────────────────────

/**
 * Returns a single minimal JSON-serializable array with only material
 * properties necessary for merge source.
 */
export function serializeMinimal(material: Material): unknown[] {
  const flagDefsRaw = getMaterialFlagDefinitions(material);
  const flagDefs: Record<string, string[]> = {};
  for (const [key, values] of Object.entries(flagDefsRaw)) {
    flagDefs[key] = [...values].sort();
  }

  // Collect unique input definitions across all shaders
  const inputDefs: ShaderInput[] = [];
  for (const pass of material.passes) {
    for (const variant of pass.variants) {
      for (const shader of variant.shaders) {
        for (const input of shader.inputs) {
          if (!inputDefs.some((d) => shaderInputsEqual(d, input))) {
            inputDefs.push(input);
          }
        }
      }
    }
  }

  inputDefs.sort((a, b) => {
    const aKey = `${a.name}_${a.semantic.index}_${a.semantic.subIndex}`;
    const bKey = `${b.name}_${b.semantic.index}_${b.semantic.subIndex}`;
    return aKey.localeCompare(bKey);
  });

  return [
    JSON_FORMAT_VERSION,
    material.version,
    material.name,
    material.parent,
    flagDefs,
    inputDefs.map(serializeShaderInputMinimal),
    material.buffers.map(serializeBufferMinimal),
    material.uniforms.map(serializeUniformMinimal),
    { ...material.uniformOverrides },
    material.passes.map((p) =>
      serializePassMinimal(p, flagDefs, inputDefs, material.version),
    ),
  ];
}

/**
 * Loads a Material from a minimal JSON array.
 */
export function loadMinimal(arr: unknown[]): Material {
  const formatVersion = arr[0] as number;
  if (formatVersion !== JSON_FORMAT_VERSION) {
    throw new Error(
      `Unsupported material.json format version: ${formatVersion}! ` +
        "Re-generate material.json files using current Lazurite version",
    );
  }

  const version = arr[1] as number;
  const name = arr[2] as string;
  const parent = arr[3] as string;
  const flagDefs = arr[4] as Record<string, string[]>;
  const inputDefs = (arr[5] as unknown[][]).map(loadShaderInputMinimal);

  const buffers = (arr[6] as unknown[][]).map(loadBufferMinimal);
  const uniforms = (arr[7] as unknown[][]).map(loadUniformMinimal);
  const uniformOverrides = arr[8] as Record<string, string>;
  const passes = (arr[9] as unknown[][]).map((p) =>
    loadPassMinimal(p, flagDefs, inputDefs, version),
  );

  return createMaterial({
    version,
    name,
    parent,
    buffers,
    uniforms,
    uniformOverrides,
    passes,
  });
}

// ── Shader Restoration ──────────────────────────────────────────

export interface RestoreShaderOptions {
  readonly platforms: ReadonlySet<ShaderPlatform>;
  readonly stages: ReadonlySet<ShaderStage>;
  readonly splitPasses?: boolean;
  readonly mergeStages?: boolean;
  readonly processShaders?: boolean;
  readonly searchTimeout?: number;
}

export interface RestoredShader {
  readonly platform: ShaderPlatform;
  readonly stage: ShaderStage;
  readonly passName: string;
  readonly code: string;
}

/**
 * Attempts to combine shader permutations into one shader.
 * Works for ESSL, GLSL, or Metal shaders.
 */
export function restoreShaders(
  material: Material,
  options: RestoreShaderOptions,
): readonly RestoredShader[] {
  const {
    platforms,
    stages,
    splitPasses = false,
    mergeStages = false,
    processShaders = false,
    searchTimeout = 10_000,
  } = options;

  if (material.passes.length === 0) return [];

  // Build flag definitions and pass list
  const flagDefinition: Record<string, Set<string>> = {};
  const passNames: string[] = [];

  for (const p of material.passes) {
    passNames.push(p.name);
    for (const [key, value] of Object.entries(p.defaultVariant)) {
      if (!flagDefinition[key]) flagDefinition[key] = new Set();
      flagDefinition[key]!.add(value);
    }
    for (const v of p.variants) {
      for (const [key, value] of Object.entries(v.flags)) {
        if (!flagDefinition[key]) flagDefinition[key] = new Set();
        flagDefinition[key]!.add(value);
      }
    }
  }
  passNames.sort();

  // Sort and convert flag definitions
  const sortedFlagDef: Record<string, string[]> = {};
  for (const key of Object.keys(flagDefinition).sort()) {
    sortedFlagDef[key] = [...flagDefinition[key]!].sort();
  }

  const restoredShaders: RestoredShader[] = [];

  for (const platform of platforms) {
    let shaderDefinitions: Record<
      string,
      Record<number, InputVariant[]>
    > = {};

    for (const shaderPass of material.passes) {
      for (const variant of shaderPass.variants) {
        for (const shader of variant.shaders) {
          if (shader.platform !== platform || !stages.has(shader.stage)) continue;

          if (!shaderDefinitions[shaderPass.name]) {
            shaderDefinitions[shaderPass.name] = {};
          }
          const passEntry = shaderDefinitions[shaderPass.name]!;
          if (!passEntry[shader.stage]) {
            passEntry[shader.stage] = [];
          }

          const flags: Record<string, string> = {};
          if (!splitPasses) flags["pass"] = shaderPass.name;
          if (mergeStages) {
            const stageVal =
              shader.stage === ShaderStage.Unknown
                ? ShaderStage.Fragment
                : shader.stage;
            flags["BGFX_SHADER_TYPE_"] =
              SHADER_STAGE_NAMES[stageVal].toUpperCase();
          }
          for (const [key, value] of Object.entries(variant.flags)) {
            flags["f_" + key] = value;
          }

          const code = TEXT_DECODER.decode(shader.bgfxShader.shaderBytes);
          passEntry[shader.stage]!.push({ flags, code });
        }
      }
    }

    if (Object.keys(shaderDefinitions).length === 0) continue;

    if (mergeStages) {
      for (const [, stageDict] of Object.entries(shaderDefinitions)) {
        const mergedList: InputVariant[] = [];
        for (const codeList of Object.values(stageDict)) {
          mergedList.push(...codeList);
        }
        // Clear and set merged
        for (const key of Object.keys(stageDict)) delete stageDict[Number(key)];
        stageDict[ShaderStage.Fragment] = mergedList;
      }
    }

    if (!splitPasses) {
      const mergedDict: Record<number, InputVariant[]> = {};
      for (const stageDict of Object.values(shaderDefinitions)) {
        for (const [stage, codeList] of Object.entries(stageDict)) {
          const stageNum = Number(stage);
          if (!mergedDict[stageNum]) mergedDict[stageNum] = [];
          mergedDict[stageNum]!.push(...codeList);
        }
      }
      shaderDefinitions = { [material.passes[0]!.name]: mergedDict };
    }

    for (const [shaderPass, stageDict] of Object.entries(shaderDefinitions)) {
      for (const [stageKey, codeList] of Object.entries(stageDict)) {
        const stage = Number(stageKey) as ShaderStage;

        const restoreOptions: RestoreCodeOptions = {
          processShaders,
          searchTimeout,
        };
        const { usedMacros, code: restoredCode } = restoreCode(
          codeList,
          restoreOptions,
        );

        let code = restoredCode;

        // Fix BGFX shader type macros
        for (const stageName of ["FRAGMENT", "VERTEX", "COMPUTE"]) {
          const macroName = `BGFX_SHADER_TYPE_${stageName}`;
          code = code
            .replace(
              new RegExp(`#ifdef ${macroName}`, "g"),
              `#if ${macroName}`,
            )
            .replace(
              new RegExp(`#ifndef ${macroName}`, "g"),
              `#if !${macroName}`,
            )
            .replace(
              new RegExp(`defined\\(${macroName}\\)`, "g"),
              macroName,
            );
        }

        // Build available macros comment
        if (
          Object.keys(sortedFlagDef).length > 0 ||
          passNames.length > 0
        ) {
          let comment = "/*\n* Available Macros:";

          if (passNames.length > 0) {
            comment += "\n*\n* Passes:";
            for (const pName of passNames) {
              const macro = generatePassNameMacro(pName);
              comment += `\n* - ${macro}`;
              if (!usedMacros.has(macro)) comment += " (not used)";
            }
          }

          if (Object.keys(sortedFlagDef).length > 0) {
            for (const [flagName, values] of Object.entries(sortedFlagDef)) {
              comment += `\n*\n* ${flagName}:`;
              for (const flagValue of values) {
                const flag = generateFlagNameMacro(
                  flagName,
                  flagValue,
                  false,
                );
                comment += `\n* - ${flag}`;
                if (!usedMacros.has(flag)) comment += " (not used)";
              }
            }
          }

          comment += "\n*/";
          code = insertHeaderComment(code, comment);
        }

        restoredShaders.push({ platform, stage, passName: shaderPass, code });
      }
    }
  }

  return restoredShaders;
}

// ── Varying Restoration ─────────────────────────────────────────

/**
 * Attempts to restore varying.def.sc file from material definition.
 */
export function restoreVaryingDef(
  material: Material,
  searchTimeout: number = 10_000,
): string {
  const permutations: InputVariant[] = [];

  for (const p of material.passes) {
    const perPassInputs: Record<
      number,
      Record<number, ShaderInput[]>
    > = {};

    for (const v of p.variants) {
      for (const s of v.shaders) {
        if (!perPassInputs[s.platform]) perPassInputs[s.platform] = {};
        const platformEntry = perPassInputs[s.platform]!;
        if (!platformEntry[s.stage]) platformEntry[s.stage] = [];
        const inputList = platformEntry[s.stage]!;

        for (const input of s.inputs) {
          if (!inputList.some((existing) => shaderInputsEqual(existing, input))) {
            inputList.push(input);
          }
        }
      }
    }

    for (const [platformKey, stageDict] of Object.entries(perPassInputs)) {
      const platform = Number(platformKey) as ShaderPlatform;
      const vertexAttributes: string[] = [];
      const fragmentVaryings: string[] = [];
      const instanceData: string[] = [];

      for (const [stageKey, inputs] of Object.entries(stageDict)) {
        const stage = Number(stageKey) as ShaderStage;
        const sorted = [...inputs].sort((a, b) =>
          a.name.localeCompare(b.name),
        );

        for (const input of sorted) {
          const { isInstanceData, line } = generateVaryingLine(input, stage);

          // Check for duplicate names (shouldn't happen)
          const duplicateCount = sorted.filter(
            (x) => x.name === input.name,
          ).length;
          const finalLine =
            duplicateCount !== 1 ? `${line} // ?` : line;

          if (isInstanceData) {
            instanceData.push(finalLine);
          } else if (stage === ShaderStage.Vertex) {
            vertexAttributes.push(finalLine);
          } else {
            fragmentVaryings.push(finalLine);
          }
        }
      }

      const blocks: string[] = [];
      if (vertexAttributes.length > 0) blocks.push(vertexAttributes.join("\n"));
      if (instanceData.length > 0) blocks.push(instanceData.join("\n"));
      if (fragmentVaryings.length > 0) blocks.push(fragmentVaryings.join("\n"));

      if (blocks.length === 0) continue;

      const text = blocks.join("\n\n");
      const flags = {
        pass: p.name,
        f_platform: SHADER_PLATFORM_NAMES[platform],
      };
      permutations.push({ flags, code: text });
    }
  }

  if (permutations.length === 0) return "";

  return restoreVarying(permutations, searchTimeout);
}
