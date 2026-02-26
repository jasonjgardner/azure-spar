/**
 * Build pipeline orchestrator.
 *
 * Compiles all BetterRTX materials using the azure-spar compilation
 * pipeline. Settings are passed as in-memory DXC defines — nothing
 * touches disk except the temp shaders for #include resolution.
 */

import { resolve } from "node:path";
import { compileMaterial } from "../compiler/mod.ts";
import type { SettingsDefines } from "../betterrtx/settings.ts";
import {
  MATERIAL_FILES,
  type ShaderData,
  type CompiledMaterialOutput,
  type BuildResult,
  type TargetMaterial,
} from "./types.ts";
import { BuildTimeoutError } from "./errors.ts";

/**
 * Compile all BetterRTX materials with the given user defines.
 *
 * Uses AbortController for timeout management. The timer is always
 * cleaned up regardless of whether the build succeeds or times out.
 *
 * Note: DXC's COM Compile is synchronous (blocks the event loop per
 * shader), so true mid-compilation cancellation is not possible without
 * worker threads. The timeout fires between shader compilations.
 */
export async function buildAllMaterials(
  shaderData: ShaderData,
  userDefines: SettingsDefines,
  settingsHash: string,
  options?: {
    readonly dxcPath?: string;
    readonly timeoutMs?: number;
  },
): Promise<BuildResult> {
  const startTime = performance.now();
  const timeoutMs = options?.timeoutMs ?? 120_000;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const materials = await executeBuild(
      shaderData,
      userDefines,
      options?.dxcPath,
      controller.signal,
    );
    const elapsedMs = performance.now() - startTime;
    return { materials, settingsHash, elapsedMs };
  } catch (err) {
    if (controller.signal.aborted) {
      throw new BuildTimeoutError(timeoutMs);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function executeBuild(
  shaderData: ShaderData,
  userDefines: SettingsDefines,
  dxcPath: string | undefined,
  signal: AbortSignal,
): Promise<readonly CompiledMaterialOutput[]> {
  const materials: CompiledMaterialOutput[] = [];

  for (const manifest of shaderData.manifests) {
    if (signal.aborted) {
      throw new BuildTimeoutError(0);
    }

    const registerDefines =
      shaderData.registerBindings[manifest.materialName] ?? {};
    const includePaths = [
      resolve(shaderData.tempShadersRoot, manifest.materialName, "shaders"),
    ];

    const { binary } = await compileMaterial(manifest, {
      dxcPath,
      registerDefines,
      userDefines,
      includePaths,
    });

    const fileName =
      MATERIAL_FILES[manifest.materialName as TargetMaterial] ??
      `${manifest.materialName}.material.bin`;

    materials.push({
      materialName: manifest.materialName,
      fileName,
      binary,
    });

    console.log(
      `[Build ${manifest.materialName}] ${manifest.shaders.length} shaders -> ${binary.length} bytes`,
    );
  }

  return materials;
}
