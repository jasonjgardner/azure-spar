/**
 * Shader compilation orchestrator.
 *
 * Pipeline: embedded HLSL → DXC compile → BgfxShader wrap → Material build → .material.bin
 */

import { getDxcCompiler, type DxcCompileOptions } from "../dxc/mod.ts";
import { loadManifestSources, type MaterialManifest } from "../betterrtx/mod.ts";
import { wrapDxilAsBgfxShader } from "./bgfx-wrapper.ts";
import {
  buildMaterial,
  type CompiledShader,
  type MaterialDefinition,
} from "./material-builder.ts";
import { writeMaterial, type Material } from "../material/material.ts";
import { ShaderPlatform } from "../material/enums.ts";

export type { MaterialDefinition, CompiledShader, PassDefinition } from "./material-builder.ts";
export { buildMaterial } from "./material-builder.ts";
export { wrapDxilAsBgfxShader, type WrapDxilOptions } from "./bgfx-wrapper.ts";

/** Options for the full compilation pipeline. */
export interface CompileMaterialOptions {
  /** Direct3D shader model platform to target. Defaults to SM65. */
  readonly platform?: ShaderPlatform;
  /** Path to dxcompiler.dll (auto-detected if omitted). */
  readonly dxcPath?: string;
  /** Additional DXC compiler arguments passed to every shader. */
  readonly additionalArgs?: readonly string[];
  /** Register binding defines (s_<name>_REG → slot) from base material. */
  readonly registerDefines?: Readonly<Record<string, string>>;
  /** Include search directories for #include resolution. */
  readonly includePaths?: readonly string[];
  /** User-provided shader setting overrides (lowest priority defines). */
  readonly userDefines?: Readonly<Record<string, string>>;
}

/** Result of the full compilation pipeline. */
export interface CompileMaterialResult {
  /** The constructed Material object. */
  readonly material: Material;
  /** Serialized .material.bin bytes. */
  readonly binary: Uint8Array;
}

/**
 * Full pipeline: load embedded HLSL → compile via DXC → wrap → build material → serialize.
 *
 * Shader source stays entirely in-memory throughout the pipeline.
 */
export async function compileMaterial(
  manifest: MaterialManifest,
  options?: CompileMaterialOptions,
): Promise<CompileMaterialResult> {
  const platform = options?.platform ?? ShaderPlatform.Direct3D_SM65;
  const dxc = getDxcCompiler(options?.dxcPath);

  // Load all shader sources from embedded files
  const sources = await loadManifestSources(manifest);

  // Compile each shader entry
  const compiledShaders: CompiledShader[] = [];

  for (const shaderEntry of manifest.shaders) {
    const source = sources.get(shaderEntry.fileName);
    if (!source) {
      throw new Error(`Source not found for shader: ${shaderEntry.fileName}`);
    }

    // Merge compiler args: pipeline-wide → manifest-wide → per-shader
    const additionalArgs = [
      ...(options?.additionalArgs ?? []),
      ...(manifest.compilerOptions ?? []),
      ...(shaderEntry.compilerOptions ?? []),
    ];

    // Merge defines: user settings (lowest) → register bindings → pass defines (highest)
    const defines = {
      ...options?.userDefines,
      ...options?.registerDefines,
      ...shaderEntry.defines,
    };

    const compileOptions: DxcCompileOptions = {
      source,
      entryPoint: shaderEntry.entryPoint,
      targetProfile: shaderEntry.targetProfile,
      additionalArgs: additionalArgs.length > 0 ? additionalArgs : undefined,
      defines: Object.keys(defines).length > 0 ? defines : undefined,
      includePaths: options?.includePaths,
    };

    const result = dxc.compile(compileOptions);

    if (!result.success) {
      throw new Error(
        `Compilation failed for ${shaderEntry.fileName}:\n${result.errors}`,
      );
    }

    const bgfxShader = wrapDxilAsBgfxShader({
      dxilBytes: result.objectBytes,
    });

    compiledShaders.push({
      stage: shaderEntry.stage,
      platform,
      bgfxShader,
      inputs: [],
    });
  }

  // Build the material structure
  const materialDef: MaterialDefinition = {
    name: manifest.materialName,
    passes: [
      {
        name: manifest.passName,
        shaders: compiledShaders,
      },
    ],
  };

  const material = buildMaterial(materialDef);
  const binary = await writeMaterial(material);

  return { material, binary };
}
