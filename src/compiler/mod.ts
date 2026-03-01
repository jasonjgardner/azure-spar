/**
 * Shader compilation orchestrator.
 *
 * Pipeline: embedded HLSL → DXC compile → BgfxShader wrap → Material build → .material.bin
 *
 * When a base material is provided (the vanilla .material.bin), compiled
 * shaders are merged into the existing pass structure — preserving version,
 * encryption, buffers, uniforms, parent info, and per-pass metadata.
 * This is the correct path for BetterRTX materials.
 *
 * Without a base material the compiler falls back to building a minimal
 * material from scratch (useful for tests but not loadable in-game).
 */

import { createDxcCompiler, type DxcCompileOptions } from "../dxc/mod.ts";
import { loadManifestSources, type MaterialManifest, type ShaderEntry } from "../betterrtx/mod.ts";
import { wrapDxilAsBgfxShader } from "./bgfx-wrapper.ts";
import {
  buildMaterial,
  type CompiledShader,
  type MaterialDefinition,
} from "./material-builder.ts";
import { readMaterial, writeMaterial, type Material } from "../material/material.ts";
import { ShaderPlatform } from "../material/enums.ts";
import type { Pass } from "../material/pass.ts";
import type { Variant } from "../material/variant.ts";
import type { ShaderDefinition } from "../material/shader-definition.ts";

export type { MaterialDefinition, CompiledShader, PassDefinition } from "./material-builder.ts";
export { buildMaterial } from "./material-builder.ts";
export { wrapDxilAsBgfxShader, type WrapDxilOptions } from "./bgfx-wrapper.ts";

// ── Source Resolution ──────────────────────────────────────────

/**
 * Resolve shader sources for a manifest from a pre-loaded map.
 *
 * The map may use keys with or without the material prefix
 * (e.g. "RTXPostFX.Bloom/shaders/Foo.hlsl" or "shaders/Foo.hlsl").
 * Tries the manifest's fileName directly first.
 */
function resolveSourcesFromMap(
  manifest: MaterialManifest,
  sourceMap: ReadonlyMap<string, Uint8Array>,
): ReadonlyMap<string, Uint8Array> {
  const resolved = new Map<string, Uint8Array>();

  for (const shader of manifest.shaders) {
    const source = sourceMap.get(shader.fileName);
    if (source) {
      resolved.set(shader.fileName, source);
      continue;
    }

    throw new Error(
      `Source not found in shaderSources map for "${shader.fileName}". ` +
        `Available keys: ${[...sourceMap.keys()].join(", ")}`,
    );
  }

  return resolved;
}

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
  /**
   * Pre-loaded shader sources keyed by relative path.
   * When provided, bypasses embedded-file / dev-mode filesystem lookup.
   * Used by the server build pipeline where shaders are loaded from R2.
   */
  readonly shaderSources?: ReadonlyMap<string, Uint8Array>;
  /**
   * Vanilla .material.bin bytes to use as base for merging.
   * Compiled shaders replace matching passes in this base material,
   * preserving all metadata (version, encryption, buffers, uniforms, etc.).
   * Required for producing in-game-loadable materials.
   */
  readonly baseMaterial?: Uint8Array;
  /**
   * Abort signal for cancelling compilation between shader compilations.
   * Checked before each individual DXC compile call.
   */
  readonly signal?: AbortSignal;
}

/** Result of the full compilation pipeline. */
export interface CompileMaterialResult {
  /** The constructed Material object. */
  readonly material: Material;
  /** Serialized .material.bin bytes. */
  readonly binary: Uint8Array;
}

/**
 * Full pipeline: load embedded HLSL → compile via DXC → wrap → merge into base or build → serialize.
 *
 * When `options.baseMaterial` is provided the compiled shaders are merged into
 * the vanilla material structure (correct for in-game loading).
 *
 * Shader source stays entirely in-memory throughout the pipeline.
 */
export async function compileMaterial(
  manifest: MaterialManifest,
  options?: CompileMaterialOptions,
): Promise<CompileMaterialResult> {
  const platform = options?.platform ?? ShaderPlatform.Direct3D_SM65;
  const dxc = await createDxcCompiler(options?.dxcPath);

  // Use pre-loaded sources if provided, otherwise load from embedded/dev filesystem
  const sources = options?.shaderSources
    ? resolveSourcesFromMap(manifest, options.shaderSources)
    : await loadManifestSources(manifest);

  // Compile each shader entry → store raw DXIL bytes keyed by pass name.
  // The merge path replaces only shaderBytes inside the vanilla BgfxShader,
  // preserving all metadata (hash, uniforms, size, attributes).
  const compiledByPass = new Map<string, { readonly stage: number; readonly dxilBytes: Uint8Array }>();

  for (const shaderEntry of manifest.shaders) {
    if (options?.signal?.aborted) {
      throw new Error("Compilation aborted");
    }

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

    const result = await dxc.compile(compileOptions);

    if (!result.success) {
      throw new Error(
        `Compilation failed for ${shaderEntry.fileName}:\n${result.errors}`,
      );
    }

    const passName = extractPassName(manifest.materialName, shaderEntry);
    compiledByPass.set(passName, { stage: shaderEntry.stage, dxilBytes: result.objectBytes });
  }

  // Merge into base material when provided — otherwise build from scratch
  if (options?.baseMaterial) {
    const base = await readMaterial(options.baseMaterial);
    const material = mergeCompiledShaders(base, compiledByPass, platform);
    const binary = await writeMaterial(material);
    return { material, binary };
  }

  // Fallback: build a minimal material from scratch (not loadable in-game)
  const compiledShaders: CompiledShader[] = [];
  for (const shaderEntry of manifest.shaders) {
    const passName = extractPassName(manifest.materialName, shaderEntry);
    const compiled = compiledByPass.get(passName);
    if (!compiled) continue;
    compiledShaders.push({
      stage: shaderEntry.stage,
      platform,
      bgfxShader: wrapDxilAsBgfxShader({ dxilBytes: compiled.dxilBytes }),
      inputs: [],
    });
  }

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

// ── Pass Name Extraction ───────────────────────────────────────

/**
 * Derive the vanilla pass name from a shader entry.
 *
 * Manifest shader names follow the pattern "MaterialName.PassName"
 * (e.g. "RTXStub.BlurGradients" → "BlurGradients",
 *       "RTXPostFX.Bloom.BloomUpscalePass" → "BloomUpscalePass").
 */
function extractPassName(materialName: string, entry: ShaderEntry): string {
  const prefix = `${materialName}.`;
  if (entry.name.startsWith(prefix)) {
    return entry.name.slice(prefix.length);
  }
  return entry.name;
}

// ── Merge Logic ────────────────────────────────────────────────

/**
 * Merge compiled shaders into a base (vanilla) material.
 *
 * Mirrors lazurite's approach:
 * 1. Filter each variant's shaders to only the target platform (SM65).
 *    This removes SM40/SM50/SM60 stubs — exactly like lazurite's
 *    `material.remove_platforms(...)` call.
 * 2. For passes that have a compiled shader, replace only the
 *    `shaderBytes` field of the matching SM65 ShaderDefinition.
 *    All metadata (hash, uniforms, attributes, size, groupSize) is
 *    preserved from the vanilla material.
 * 3. Uncompiled SM65 shader definitions (e.g. Vertex stubs for
 *    RTXPostFX fragment-only passes) are kept unchanged.
 * 4. Empty shaders (zero-length shaderBytes) are filtered out —
 *    matching lazurite's post-compilation cleanup.
 */
function mergeCompiledShaders(
  base: Material,
  compiledByPass: ReadonlyMap<string, { readonly stage: number; readonly dxilBytes: Uint8Array }>,
  platform: ShaderPlatform,
): Material {
  const newPasses: Pass[] = base.passes.map((pass) => {
    const compiled = compiledByPass.get(pass.name);

    const newVariants: Variant[] = pass.variants.map((variant) => {
      // Step 1: Keep only target-platform shader definitions
      const sm65Shaders = variant.shaders.filter(
        (s) => s.platform === platform,
      );

      // Step 2: Replace shaderBytes for the compiled stage
      const updatedShaders: ShaderDefinition[] = sm65Shaders.map((shader) => {
        if (!compiled) return shader;
        if (shader.stage !== compiled.stage) return shader;

        // Replace only the DXIL bytes — preserve all BgfxShader metadata
        return {
          ...shader,
          bgfxShader: {
            ...shader.bgfxShader,
            shaderBytes: compiled.dxilBytes,
          },
        };
      });

      // Step 3: Filter out empty shaders (matches lazurite's cleanup)
      const nonEmpty = updatedShaders.filter(
        (s) => s.bgfxShader.shaderBytes.length > 0,
      );

      return { ...variant, shaders: nonEmpty };
    });

    return { ...pass, variants: newVariants };
  });

  return { ...base, passes: newPasses };
}
