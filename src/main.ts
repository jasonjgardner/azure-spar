#!/usr/bin/env bun
/**
 * BetterRTX material compiler CLI.
 *
 * Compiles all BetterRTX shader manifests into .material.bin files.
 *
 * Usage:
 *   bun run src/main.ts [--output dir] [--dxc path] [--settings path/to/settings.json]
 *   ./brtxbuilder.exe [--output dir] [--dxc path] [--settings path/to/settings.json]
 */

import { resolve } from "node:path";
import { mkdir } from "node:fs/promises";
import {
  loadManifests,
  loadRegisterBindings,
} from "./betterrtx/mod.ts";
import { loadSettingsFile, settingsToDefines } from "./betterrtx/settings.ts";
import { compileMaterial } from "./compiler/mod.ts";
import { disposeUnifiedCompiler } from "./dxc/mod.ts";
import type { MaterialManifest } from "./betterrtx/manifest-types.ts";
import type { SettingsDefines } from "./betterrtx/settings.ts";

// ── Paths ────────────────────────────────────────────────────────

const PROJECT_ROOT = resolve(import.meta.dir, "..");
const SHADERS_DIR = resolve(PROJECT_ROOT, "shaders");
const DEFAULT_OUTPUT = resolve(PROJECT_ROOT, "output");

// ── CLI ──────────────────────────────────────────────────────────

function getArg(flag: string): string | undefined {
  const idx = Bun.argv.indexOf(flag);
  if (idx === -1) return undefined;
  return Bun.argv[idx + 1];
}

// ── Helpers ──────────────────────────────────────────────────────

function includePathsForMaterial(materialName: string): readonly string[] {
  return [resolve(SHADERS_DIR, materialName, "shaders")];
}

async function loadUserSettings(): Promise<SettingsDefines> {
  const settingsPath = getArg("--settings");
  if (!settingsPath) return {};

  const settings = await loadSettingsFile(resolve(settingsPath));
  const defines = settingsToDefines(settings);
  const count = Object.keys(defines).length;

  if (count > 0) {
    console.log(`User settings: ${count} overrides from ${settingsPath}`);
  }

  return defines;
}

async function compileAndWrite(
  manifest: MaterialManifest,
  registerDefines: Readonly<Record<string, string>>,
  userDefines: SettingsDefines,
  outputDir: string,
  dxcPath?: string,
): Promise<boolean> {
  try {
    const { binary } = await compileMaterial(manifest, {
      dxcPath,
      registerDefines,
      userDefines,
      includePaths: includePathsForMaterial(manifest.materialName),
    });

    const outPath = resolve(
      outputDir,
      `${manifest.materialName}.material.bin`,
    );
    await Bun.write(outPath, binary);

    console.log(
      `  ${manifest.materialName}: ${manifest.shaders.length} shaders -> ${binary.length} bytes`,
    );
    return true;
  } catch (err) {
    console.error(`  ${manifest.materialName}: FAILED`);
    console.error(`    ${err}`);
    return false;
  }
}

// ── Main ─────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const outputDir = getArg("--output")
    ? resolve(getArg("--output")!)
    : DEFAULT_OUTPUT;
  const dxcPath = getArg("--dxc");

  console.log("=== BetterRTX Material Compiler ===\n");

  // Load manifests
  const manifests = await loadManifests();
  console.log(`Manifests: ${manifests.length} materials`);

  // Load register bindings
  const registerBindings = await loadRegisterBindings();
  for (const [name, bindings] of Object.entries(registerBindings)) {
    const count = Object.keys(bindings).length;
    if (count > 0) {
      console.log(`  ${name}: ${count} register bindings`);
    }
  }

  // Load user settings
  const userDefines = await loadUserSettings();

  // Ensure output directory exists
  await mkdir(outputDir, { recursive: true });
  console.log(`\nOutput: ${outputDir}\n`);

  // Compile each material
  let passed = 0;
  let failed = 0;

  for (const manifest of manifests) {
    const defines = registerBindings[manifest.materialName] ?? {};
    const success = await compileAndWrite(
      manifest,
      defines,
      userDefines,
      outputDir,
      dxcPath,
    );

    if (success) {
      passed++;
    } else {
      failed++;
    }
  }

  // Cleanup
  disposeUnifiedCompiler();

  console.log(`\n=== ${passed} compiled, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("\nCompilation failed:", err);
  process.exit(1);
});
