/**
 * Parser for BetterRTX project and material config files.
 *
 * project.json defines: platforms, merge source, material include patterns.
 * config.json (per material) defines: compiler type/options, pass→shader mappings.
 */

import { ShaderStage } from "../material/enums.ts";
import type { ShaderEntry, MaterialManifest } from "./shader-manifest.ts";

// ── Config JSON schema ────────────────────────────────────────────

interface PassOverwrite {
  readonly entry_point?: string;
  readonly compute?: string;
  readonly fragment?: string;
  readonly vertex?: string;
}

interface FileOverwrite {
  readonly default?: { readonly entry_point?: string };
  readonly passes: Readonly<Record<string, PassOverwrite>>;
}

interface CompilerConfig {
  readonly type: string;
  readonly options?: readonly string[];
}

export interface MaterialConfig {
  readonly compiler: CompilerConfig;
  readonly macro_overwrite?: Readonly<Record<string, string>>;
  readonly file_overwrite: FileOverwrite;
}

export interface ProjectConfig {
  readonly base_profile: {
    readonly platforms: readonly string[];
    readonly merge_source: readonly string[];
    readonly include_patterns: readonly string[];
  };
}

// ── Parsing ───────────────────────────────────────────────────────

export function parseProjectConfig(json: string): ProjectConfig {
  return JSON.parse(json) as ProjectConfig;
}

export function parseMaterialConfig(json: string): MaterialConfig {
  return JSON.parse(json) as MaterialConfig;
}

// ── Stage detection ───────────────────────────────────────────────

function resolvePassStageAndFile(pass: PassOverwrite): {
  stage: ShaderStage;
  file: string;
} | null {
  if (pass.compute) return { stage: ShaderStage.Compute, file: pass.compute };
  if (pass.fragment) return { stage: ShaderStage.Fragment, file: pass.fragment };
  if (pass.vertex) return { stage: ShaderStage.Vertex, file: pass.vertex };
  return null;
}

function targetProfileForStage(stage: ShaderStage): string {
  if (stage === ShaderStage.Vertex) return "vs_6_5";
  if (stage === ShaderStage.Fragment) return "ps_6_5";
  return "cs_6_5";
}

// ── Manifest generation ───────────────────────────────────────────

/**
 * Build a MaterialManifest from a parsed config.json.
 *
 * @param materialName - The material directory name (e.g., "RTXStub")
 * @param config - Parsed material config
 * @param shaderBasePath - Path prefix for shader files (e.g., "RTXStub/")
 */
export function buildManifestFromConfig(
  materialName: string,
  config: MaterialConfig,
): MaterialManifest {
  const defaultEntryPoint = config.file_overwrite.default?.entry_point;
  const compilerOptions = config.compiler.options ?? [];

  const shaders: ShaderEntry[] = [];

  for (const [passName, passOverwrite] of Object.entries(config.file_overwrite.passes)) {
    const resolved = resolvePassStageAndFile(passOverwrite);
    if (!resolved) continue;

    const entryPoint = passOverwrite.entry_point ?? defaultEntryPoint ?? passName;

    shaders.push({
      name: `${materialName}.${passName}`,
      fileName: `${materialName}/${resolved.file}`,
      stage: resolved.stage,
      entryPoint,
      targetProfile: targetProfileForStage(resolved.stage),
      defines: {
        ...config.macro_overwrite,
        [`__PASS_${passName.toUpperCase()}__`]: "1",
      },
      compilerOptions,
    });
  }

  return {
    materialName,
    passName: materialName,
    shaders,
  };
}

/**
 * Discover material directories from archive file paths.
 * Returns directory names that contain a config.json.
 */
export function discoverMaterials(
  filePaths: readonly string[],
  archivePrefix: string,
): readonly string[] {
  const materials = new Set<string>();

  for (const path of filePaths) {
    if (!path.startsWith(archivePrefix)) continue;
    const relative = path.slice(archivePrefix.length);
    if (relative.endsWith("/config.json")) {
      const dir = relative.replace("/config.json", "");
      if (!dir.includes("/")) {
        materials.add(dir);
      }
    }
  }

  return [...materials].sort();
}
