#!/usr/bin/env bun
/**
 * Compare azure-spar vs Lazurite output.
 *
 * 1. Generates a Lazurite project from shaders/manifest.json
 * 2. Builds with both azure-spar (bun run src/main.ts) and Lazurite (lazurite build)
 * 3. Compares the resulting .material.bin files:
 *    - Binary-level (size, byte diff positions)
 *    - Structural (Material metadata, Pass/Variant/Shader hierarchy)
 *    - BgfxShader wrapper fields (hash, uniforms, groupSize, attributes, size)
 *    - DXIL bytecode sizes and content
 *
 * Usage:
 *   bun run scripts/compare-builds.ts [--settings path/to/settings.json]
 *   bun run scripts/compare-builds.ts --skip-build    # compare existing output
 */

import { resolve, join, relative } from "node:path";
import { mkdir, rm, readdir, symlink } from "node:fs/promises";
import { readMaterial, type Material } from "../src/material/material.ts";
import type { Pass } from "../src/material/pass.ts";
import type { ShaderDefinition } from "../src/material/shader-definition.ts";
import type { BgfxShader, BgfxUniform } from "../src/material/bgfx-shader.ts";
import type { MaterialManifest, ShaderEntry } from "../src/betterrtx/manifest-types.ts";
import { ShaderStage, ShaderPlatform } from "../src/material/enums.ts";

// ── Constants ────────────────────────────────────────────────────

const PROJECT_ROOT = resolve(import.meta.dir, "..");
const SHADERS_DIR = resolve(PROJECT_ROOT, "shaders");
const MATERIALS_BACKUP = resolve(PROJECT_ROOT, "materials-backup");
const TEST_OUTPUT = resolve(PROJECT_ROOT, "test-output");
const LAZURITE_PROJECT = resolve(TEST_OUTPUT, "lazurite-project");
const LAZURITE_OUTPUT = resolve(TEST_OUTPUT, "lazurite");
const SPAR_OUTPUT = resolve(TEST_OUTPUT, "azure-spar");
const REPORT_PATH = resolve(TEST_OUTPUT, "comparison-report.txt");

const TARGET_MATERIALS = [
  "RTXStub",
  "RTXPostFX.Tonemapping",
  "RTXPostFX.Bloom",
] as const;

// ── CLI helpers ──────────────────────────────────────────────────

function getArg(flag: string): string | undefined {
  const idx = Bun.argv.indexOf(flag);
  if (idx === -1) return undefined;
  return Bun.argv[idx + 1];
}

const skipBuild = Bun.argv.includes("--skip-build");
const settingsPath = getArg("--settings");

// ── Report buffer ────────────────────────────────────────────────

const reportLines: string[] = [];

function log(msg: string): void {
  console.log(msg);
  reportLines.push(msg);
}

function logSection(title: string): void {
  const line = "─".repeat(60);
  log(`\n${line}`);
  log(`  ${title}`);
  log(line);
}

// ── Lazurite project generation ──────────────────────────────────

function stageToConfigKey(stage: number): string {
  if (stage === ShaderStage.Vertex) return "vertex";
  if (stage === ShaderStage.Fragment) return "fragment";
  return "compute";
}

interface LazuriteConfig {
  readonly compiler: {
    readonly type: string;
    readonly options: readonly string[];
  };
  readonly file_overwrite: {
    readonly passes: Readonly<Record<string, Record<string, string>>>;
  };
}

function buildLazuriteConfig(manifest: MaterialManifest): LazuriteConfig {
  const compilerOptions = manifest.shaders[0]?.compilerOptions ?? [];

  const passes: Record<string, Record<string, string>> = {};
  for (const shader of manifest.shaders) {
    const passName = shader.name.replace(`${manifest.materialName}.`, "");
    const stageKey = stageToConfigKey(shader.stage);
    // manifest.fileName is like "RTXStub/shaders/AdaptiveDenoiser.hlsl"
    // Lazurite config expects relative to material dir: "shaders/AdaptiveDenoiser.hlsl"
    const relativeFile = shader.fileName.replace(`${manifest.materialName}/`, "");

    passes[passName] = {
      entry_point: shader.entryPoint,
      [stageKey]: relativeFile,
    };
  }

  return {
    compiler: {
      type: "dxc",
      options: [...compilerOptions],
    },
    file_overwrite: { passes },
  };
}

interface LazuriteProject {
  readonly base_profile: {
    readonly platforms: readonly string[];
    readonly merge_source: readonly string[];
  };
}

function buildProjectJson(): LazuriteProject {
  // Use relative path from lazurite project dir to materials-backup
  const relMerge = relative(LAZURITE_PROJECT, MATERIALS_BACKUP).replace(/\\/g, "/");
  return {
    base_profile: {
      platforms: ["Direct3D_SM65"],
      merge_source: [relMerge],
    },
  };
}

async function setupLazuriteProject(manifests: readonly MaterialManifest[]): Promise<void> {
  logSection("Setting up Lazurite project");

  // Clean and create project directory
  await rm(LAZURITE_PROJECT, { recursive: true, force: true });
  await mkdir(LAZURITE_PROJECT, { recursive: true });

  // Write project.json
  const projectJson = buildProjectJson();
  await Bun.write(
    join(LAZURITE_PROJECT, "project.json"),
    JSON.stringify(projectJson, null, 2),
  );
  log(`  Wrote project.json`);
  log(`    platforms: ${projectJson.base_profile.platforms.join(", ")}`);
  log(`    merge_source: ${projectJson.base_profile.merge_source.join(", ")}`);

  // For each material, create directory with config.json and junction to shaders
  for (const manifest of manifests) {
    const materialDir = join(LAZURITE_PROJECT, manifest.materialName);
    await mkdir(materialDir, { recursive: true });

    // Write config.json
    const config = buildLazuriteConfig(manifest);
    await Bun.write(
      join(materialDir, "config.json"),
      JSON.stringify(config, null, 2),
    );
    log(`  ${manifest.materialName}/config.json (${manifest.shaders.length} passes)`);

    // Create directory junction to actual shader source
    const shaderSrc = resolve(SHADERS_DIR, manifest.materialName, "shaders");
    const shaderDst = join(materialDir, "shaders");

    try {
      await symlink(shaderSrc, shaderDst, "junction");
      log(`  ${manifest.materialName}/shaders → ${shaderSrc}`);
    } catch (err) {
      // Junction might already exist
      log(`  Warning: Could not create junction for ${manifest.materialName}/shaders: ${err}`);
    }
  }

  log(`\n  Lazurite project ready at: ${LAZURITE_PROJECT}`);
}

// ── Build runners ────────────────────────────────────────────────

async function runCommand(
  cmd: string[],
  cwd: string,
  label: string,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  log(`\n  Running: ${cmd.join(" ")}`);
  log(`  Working dir: ${cwd}`);

  const proc = Bun.spawn(cmd, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  if (stdout.trim()) {
    for (const line of stdout.trim().split("\n")) {
      log(`  [${label}] ${line}`);
    }
  }
  if (stderr.trim()) {
    for (const line of stderr.trim().split("\n")) {
      log(`  [${label} ERR] ${line}`);
    }
  }

  log(`  Exit code: ${exitCode}`);
  return { exitCode, stdout, stderr };
}

async function buildWithAzureSpar(): Promise<boolean> {
  logSection("Building with azure-spar");
  await mkdir(SPAR_OUTPUT, { recursive: true });

  const cmd = ["bun", "run", "src/main.ts", "--output", SPAR_OUTPUT];
  if (settingsPath) cmd.push("--settings", resolve(settingsPath));

  const result = await runCommand(cmd, PROJECT_ROOT, "azure-spar");
  return result.exitCode === 0;
}

async function buildWithLazurite(): Promise<boolean> {
  logSection("Building with Lazurite");
  await mkdir(LAZURITE_OUTPUT, { recursive: true });

  const cmd = [
    "lazurite", "build", LAZURITE_PROJECT,
    "-o", LAZURITE_OUTPUT,
  ];

  const result = await runCommand(cmd, PROJECT_ROOT, "lazurite");
  return result.exitCode === 0;
}

// ── Binary comparison ────────────────────────────────────────────

function findByteOffsetDiffs(
  a: Uint8Array,
  b: Uint8Array,
  maxDiffs: number = 50,
): number[] {
  const offsets: number[] = [];
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (a[i] !== b[i]) {
      offsets.push(i);
      if (offsets.length >= maxDiffs) break;
    }
  }
  return offsets;
}

function hexDump(data: Uint8Array, offset: number, context: number = 8): string {
  const start = Math.max(0, offset - context);
  const end = Math.min(data.length, offset + context + 1);
  const bytes: string[] = [];
  for (let i = start; i < end; i++) {
    const hex = (data[i] ?? 0).toString(16).padStart(2, "0");
    if (i === offset) {
      bytes.push(`[${hex}]`);
    } else {
      bytes.push(hex);
    }
  }
  return `0x${start.toString(16).padStart(6, "0")}: ${bytes.join(" ")}`;
}

// ── Structural comparison ────────────────────────────────────────

function compareMaterialMeta(label: string, spar: Material, lazurite: Material): void {
  log(`\n  === Material Metadata: ${label} ===`);

  const fields: Array<[string, unknown, unknown]> = [
    ["version", spar.version, lazurite.version],
    ["name", spar.name, lazurite.name],
    ["encryption", spar.encryption, lazurite.encryption],
    ["parent", spar.parent, lazurite.parent],
    ["buffers.length", spar.buffers.length, lazurite.buffers.length],
    ["uniforms.length", spar.uniforms.length, lazurite.uniforms.length],
    ["passes.length", spar.passes.length, lazurite.passes.length],
  ];

  for (const [name, sparVal, lazVal] of fields) {
    const match = sparVal === lazVal ? "✓" : "✗ DIFF";
    log(`    ${name}: spar=${sparVal} | laz=${lazVal}  ${match}`);
  }

  // Compare buffer names & properties
  if (spar.buffers.length > 0 || lazurite.buffers.length > 0) {
    log(`\n    Buffers:`);
    const sparNames = spar.buffers.map(b => b.name).sort();
    const lazNames = lazurite.buffers.map(b => b.name).sort();
    const allNames = [...new Set([...sparNames, ...lazNames])].sort();
    for (const name of allNames) {
      const inSpar = sparNames.includes(name);
      const inLaz = lazNames.includes(name);
      if (inSpar && inLaz) {
        log(`      ${name}: both ✓`);
      } else if (inSpar) {
        log(`      ${name}: spar only ✗`);
      } else {
        log(`      ${name}: lazurite only ✗`);
      }
    }
  }

  // Compare uniforms
  if (spar.uniforms.length > 0 || lazurite.uniforms.length > 0) {
    log(`\n    Uniforms:`);
    const sparNames = spar.uniforms.map(u => u.name).sort();
    const lazNames = lazurite.uniforms.map(u => u.name).sort();
    const allNames = [...new Set([...sparNames, ...lazNames])].sort();
    for (const name of allNames) {
      const inSpar = sparNames.includes(name);
      const inLaz = lazNames.includes(name);
      if (inSpar && inLaz) {
        log(`      ${name}: both ✓`);
      } else if (inSpar) {
        log(`      ${name}: spar only ✗`);
      } else {
        log(`      ${name}: lazurite only ✗`);
      }
    }
  }

  // Compare uniform overrides
  const sparOverrides = Object.entries(spar.uniformOverrides);
  const lazOverrides = Object.entries(lazurite.uniformOverrides);
  if (sparOverrides.length > 0 || lazOverrides.length > 0) {
    log(`\n    Uniform Overrides:`);
    log(`      spar: ${JSON.stringify(spar.uniformOverrides)}`);
    log(`      laz:  ${JSON.stringify(lazurite.uniformOverrides)}`);
  }
}

function comparePassByName(
  materialName: string,
  sparPasses: readonly Pass[],
  lazPasses: readonly Pass[],
): void {
  const sparMap = new Map(sparPasses.map(p => [p.name, p]));
  const lazMap = new Map(lazPasses.map(p => [p.name, p]));
  const allPassNames = [...new Set([...sparMap.keys(), ...lazMap.keys()])].sort();

  for (const passName of allPassNames) {
    const sp = sparMap.get(passName);
    const lp = lazMap.get(passName);

    if (!sp) {
      log(`\n  Pass "${passName}": lazurite only ✗`);
      continue;
    }
    if (!lp) {
      log(`\n  Pass "${passName}": spar only ✗`);
      continue;
    }

    log(`\n  Pass "${passName}":`);
    log(`    fallbackPass: spar="${sp.fallbackPass}" | laz="${lp.fallbackPass}" ${sp.fallbackPass === lp.fallbackPass ? "✓" : "✗"}`);
    log(`    defaultBlendMode: spar=${sp.defaultBlendMode} | laz=${lp.defaultBlendMode} ${sp.defaultBlendMode === lp.defaultBlendMode ? "✓" : "✗"}`);
    log(`    framebufferBinding: spar=${sp.framebufferBinding} | laz=${lp.framebufferBinding} ${sp.framebufferBinding === lp.framebufferBinding ? "✓" : "✗"}`);
    log(`    variants: spar=${sp.variants.length} | laz=${lp.variants.length} ${sp.variants.length === lp.variants.length ? "✓" : "✗"}`);

    // Compare default variant flags
    const sparFlags = JSON.stringify(sp.defaultVariant);
    const lazFlags = JSON.stringify(lp.defaultVariant);
    log(`    defaultVariant: spar=${sparFlags} | laz=${lazFlags} ${sparFlags === lazFlags ? "✓" : "✗"}`);

    // Compare variants
    const variantCount = Math.min(sp.variants.length, lp.variants.length);
    for (let vi = 0; vi < variantCount; vi++) {
      const sv = sp.variants[vi]!;
      const lv = lp.variants[vi]!;

      const flagsMatch = JSON.stringify(sv.flags) === JSON.stringify(lv.flags);
      const supportedMatch = sv.isSupported === lv.isSupported;
      const shaderCountMatch = sv.shaders.length === lv.shaders.length;

      if (!flagsMatch || !supportedMatch || !shaderCountMatch) {
        log(`    Variant ${vi}: flags=${flagsMatch ? "✓" : "✗"} supported=${supportedMatch ? "✓" : "✗"} shaders=${shaderCountMatch ? "✓" : "✗"}`);
        if (!flagsMatch) {
          log(`      spar flags: ${JSON.stringify(sv.flags)}`);
          log(`      laz flags:  ${JSON.stringify(lv.flags)}`);
        }
      }

      // Compare individual shaders
      const shaderCount = Math.min(sv.shaders.length, lv.shaders.length);
      for (let si = 0; si < shaderCount; si++) {
        compareShaderDefinition(passName, vi, si, sv.shaders[si]!, lv.shaders[si]!);
      }
    }
  }
}

function compareShaderDefinition(
  passName: string,
  variantIdx: number,
  shaderIdx: number,
  spar: ShaderDefinition,
  laz: ShaderDefinition,
): void {
  const prefix = `    [v${variantIdx},s${shaderIdx}]`;

  const diffs: string[] = [];

  if (spar.stage !== laz.stage) {
    diffs.push(`stage: spar=${spar.stage} laz=${laz.stage}`);
  }
  if (spar.platform !== laz.platform) {
    diffs.push(`platform: spar=${spar.platform} laz=${laz.platform}`);
  }
  if (spar.hash !== laz.hash) {
    diffs.push(`hash: spar=${spar.hash} laz=${laz.hash}`);
  }
  if (spar.inputs.length !== laz.inputs.length) {
    diffs.push(`inputs: spar=${spar.inputs.length} laz=${laz.inputs.length}`);
  }

  // BgfxShader comparison
  const sparBgfx = spar.bgfxShader;
  const lazBgfx = laz.bgfxShader;

  if (sparBgfx.hash !== lazBgfx.hash) {
    diffs.push(`bgfx.hash: spar=${sparBgfx.hash} laz=${lazBgfx.hash}`);
  }
  if (sparBgfx.size !== lazBgfx.size) {
    diffs.push(`bgfx.size: spar=${sparBgfx.size} laz=${lazBgfx.size}`);
  }
  if (sparBgfx.uniforms.length !== lazBgfx.uniforms.length) {
    diffs.push(`bgfx.uniforms: spar=${sparBgfx.uniforms.length} laz=${lazBgfx.uniforms.length}`);
  }

  // Compare DXIL bytecode
  const sparDxilSize = sparBgfx.shaderBytes.length;
  const lazDxilSize = lazBgfx.shaderBytes.length;
  if (sparDxilSize !== lazDxilSize) {
    diffs.push(`dxil.size: spar=${sparDxilSize} laz=${lazDxilSize}`);
  }

  const dxilMatch = sparDxilSize === lazDxilSize &&
    sparBgfx.shaderBytes.every((b, i) => b === lazBgfx.shaderBytes[i]);

  if (!dxilMatch) {
    diffs.push(`dxil.content: DIFFERENT`);
  }

  // Compare group_size
  const sparGroupStr = JSON.stringify(sparBgfx.groupSize);
  const lazGroupStr = JSON.stringify(lazBgfx.groupSize);
  if (sparGroupStr !== lazGroupStr) {
    diffs.push(`bgfx.groupSize: spar=${sparGroupStr} laz=${lazGroupStr}`);
  }

  // Compare attributes
  const sparAttrStr = JSON.stringify(sparBgfx.attributes);
  const lazAttrStr = JSON.stringify(lazBgfx.attributes);
  if (sparAttrStr !== lazAttrStr) {
    diffs.push(`bgfx.attributes: spar=${sparAttrStr} laz=${lazAttrStr}`);
  }

  if (diffs.length > 0) {
    log(`${prefix} DIFFERENCES:`);
    for (const d of diffs) {
      log(`${prefix}   ${d}`);
    }
  }

  // Detailed uniform comparison if counts differ or any mismatch
  compareBgfxUniforms(prefix, sparBgfx.uniforms, lazBgfx.uniforms);
}

function compareBgfxUniforms(
  prefix: string,
  sparUniforms: readonly BgfxUniform[],
  lazUniforms: readonly BgfxUniform[],
): void {
  const count = Math.max(sparUniforms.length, lazUniforms.length);
  if (count === 0) return;

  const diffs: string[] = [];

  for (let i = 0; i < count; i++) {
    const su = sparUniforms[i];
    const lu = lazUniforms[i];

    if (!su) {
      diffs.push(`uniform[${i}]: lazurite only → ${lu!.name}`);
      continue;
    }
    if (!lu) {
      diffs.push(`uniform[${i}]: spar only → ${su.name}`);
      continue;
    }

    if (su.name !== lu.name || su.typeBits !== lu.typeBits ||
        su.count !== lu.count || su.regIndex !== lu.regIndex ||
        su.regCount !== lu.regCount) {
      diffs.push(
        `uniform[${i}] "${su.name}"→"${lu.name}" ` +
        `type=${su.typeBits}→${lu.typeBits} ` +
        `cnt=${su.count}→${lu.count} ` +
        `reg=${su.regIndex}→${lu.regIndex} ` +
        `regCnt=${su.regCount}→${lu.regCount}`,
      );
    }
  }

  if (diffs.length > 0) {
    log(`${prefix}   BgfxUniforms:`);
    for (const d of diffs) {
      log(`${prefix}     ${d}`);
    }
  }
}

// ── Lazurite unpack comparison ───────────────────────────────────

async function unpackAndCompare(materialName: string): Promise<void> {
  const sparBin = join(SPAR_OUTPUT, `${materialName}.material.bin`);
  const lazBin = join(LAZURITE_OUTPUT, `${materialName}.material.bin`);
  const unpackDir = join(TEST_OUTPUT, "unpacked");
  const sparUnpack = join(unpackDir, "spar");
  const lazUnpack = join(unpackDir, "lazurite");

  // Clean stale unpack output for this material
  await rm(join(sparUnpack, materialName), { recursive: true, force: true });
  await rm(join(lazUnpack, materialName), { recursive: true, force: true });
  await mkdir(sparUnpack, { recursive: true });
  await mkdir(lazUnpack, { recursive: true });

  // Unpack both with lazurite
  log(`\n  Unpacking ${materialName} with lazurite...`);

  const sparProc = Bun.spawn(["lazurite", "unpack", sparBin, "--sort-flags", "-o", sparUnpack], {
    stdout: "pipe", stderr: "pipe",
  });
  await sparProc.exited;

  const lazProc = Bun.spawn(["lazurite", "unpack", lazBin, "--sort-flags", "-o", lazUnpack], {
    stdout: "pipe", stderr: "pipe",
  });
  await lazProc.exited;

  // Compare unpacked JSON files
  const sparJsons = await findJsonFiles(join(sparUnpack, materialName));
  const lazJsons = await findJsonFiles(join(lazUnpack, materialName));

  const allPaths = [...new Set([...sparJsons, ...lazJsons])].sort();
  for (const relPath of allPaths) {
    const sparFile = join(sparUnpack, materialName, relPath);
    const lazFile = join(lazUnpack, materialName, relPath);

    const sparExists = await Bun.file(sparFile).exists();
    const lazExists = await Bun.file(lazFile).exists();

    if (!sparExists) {
      log(`    ${relPath}: lazurite only ✗`);
      continue;
    }
    if (!lazExists) {
      log(`    ${relPath}: spar only ✗`);
      continue;
    }

    try {
      const sparContent = await Bun.file(sparFile).text();
      const lazContent = await Bun.file(lazFile).text();

      if (sparContent === lazContent) {
        log(`    ${relPath}: identical ✓`);
      } else {
        log(`    ${relPath}: DIFFERENT ✗`);
        // Show a brief diff summary
        const sparLines = sparContent.split("\n");
        const lazLines = lazContent.split("\n");
        let diffCount = 0;
        const maxShow = 10;
        for (let i = 0; i < Math.max(sparLines.length, lazLines.length); i++) {
          if (sparLines[i] !== lazLines[i]) {
            diffCount++;
            if (diffCount <= maxShow) {
              log(`      Line ${i + 1}:`);
              if (sparLines[i] !== undefined) log(`        spar: ${sparLines[i]?.slice(0, 120)}`);
              if (lazLines[i] !== undefined) log(`        laz:  ${lazLines[i]?.slice(0, 120)}`);
            }
          }
        }
        if (diffCount > maxShow) {
          log(`      ... and ${diffCount - maxShow} more line differences`);
        }
      }
    } catch {
      // Binary file or read error
      log(`    ${relPath}: could not compare`);
    }
  }
}

async function findJsonFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  try {
    await collectFiles(dir, dir, results);
  } catch {
    // Directory might not exist
  }
  return results;
}

async function collectFiles(base: string, current: string, results: string[]): Promise<void> {
  const entries = await readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    const full = join(current, entry.name);
    if (entry.isDirectory()) {
      await collectFiles(base, full, results);
    } else if (entry.name.endsWith(".json")) {
      results.push(relative(base, full).replace(/\\/g, "/"));
    }
  }
}

// ── Main ─────────────────────────────────────────────────────────

async function main(): Promise<void> {
  log("╔══════════════════════════════════════════════════════════════╗");
  log("║      azure-spar vs Lazurite Output Comparison              ║");
  log("╚══════════════════════════════════════════════════════════════╝");

  // Validate materials-backup exists
  const backupFiles = await readdir(MATERIALS_BACKUP).catch(() => []);
  const hasMaterials = backupFiles.some((f) =>
    typeof f === "string" && f.endsWith(".material.bin"),
  );
  if (!hasMaterials) {
    log("\nERROR: No .material.bin files found in materials-backup/");
    log("Run scripts/setup.ts first to backup vanilla materials.");
    process.exit(1);
  }

  // Load manifests
  const manifests: MaterialManifest[] = await Bun.file(
    join(SHADERS_DIR, "manifest.json"),
  ).json();
  log(`\nLoaded ${manifests.length} material manifests`);

  // Ensure output directories
  await mkdir(TEST_OUTPUT, { recursive: true });

  if (!skipBuild) {
    // ── Step 1: Set up Lazurite project ────────────────────────
    await setupLazuriteProject(manifests);

    // ── Step 2: Build with azure-spar ──────────────────────────
    const sparOk = await buildWithAzureSpar();
    if (!sparOk) {
      log("\nERROR: azure-spar build failed");
      process.exit(1);
    }

    // ── Step 3: Build with Lazurite ────────────────────────────
    const lazOk = await buildWithLazurite();
    if (!lazOk) {
      log("\nERROR: Lazurite build failed");
      process.exit(1);
    }
  } else {
    log("\n  (Skipping builds, using existing output)");
  }

  // ── Step 4: Compare outputs ──────────────────────────────────
  logSection("Binary Comparison");

  for (const name of TARGET_MATERIALS) {
    const sparPath = join(SPAR_OUTPUT, `${name}.material.bin`);
    const lazPath = join(LAZURITE_OUTPUT, `${name}.material.bin`);

    const sparExists = await Bun.file(sparPath).exists();
    const lazExists = await Bun.file(lazPath).exists();

    if (!sparExists) {
      log(`\n  ${name}: azure-spar output missing ✗`);
      continue;
    }
    if (!lazExists) {
      log(`\n  ${name}: Lazurite output missing ✗`);
      continue;
    }

    const sparBytes = new Uint8Array(await Bun.file(sparPath).arrayBuffer());
    const lazBytes = new Uint8Array(await Bun.file(lazPath).arrayBuffer());

    log(`\n  ${name}:`);
    log(`    azure-spar: ${sparBytes.length} bytes`);
    log(`    Lazurite:   ${lazBytes.length} bytes`);
    log(`    Size delta: ${sparBytes.length - lazBytes.length} bytes`);

    if (sparBytes.length === lazBytes.length &&
        sparBytes.every((b, i) => b === lazBytes[i])) {
      log(`    Binary: IDENTICAL ✓`);
      continue;
    }

    log(`    Binary: DIFFERENT ✗`);
    const diffOffsets = findByteOffsetDiffs(sparBytes, lazBytes);
    log(`    First ${diffOffsets.length} diff offsets: ${diffOffsets.map(o => `0x${o.toString(16)}`).join(", ")}`);

    if (diffOffsets.length > 0) {
      log(`\n    First diff at 0x${diffOffsets[0]!.toString(16)}:`);
      log(`      spar: ${hexDump(sparBytes, diffOffsets[0]!)}`);
      log(`      laz:  ${hexDump(lazBytes, diffOffsets[0]!)}`);
    }
  }

  // ── Step 5: Structural comparison ────────────────────────────
  logSection("Structural Comparison");

  for (const name of TARGET_MATERIALS) {
    const sparPath = join(SPAR_OUTPUT, `${name}.material.bin`);
    const lazPath = join(LAZURITE_OUTPUT, `${name}.material.bin`);

    const sparExists = await Bun.file(sparPath).exists();
    const lazExists = await Bun.file(lazPath).exists();
    if (!sparExists || !lazExists) continue;

    try {
      const sparBytes = new Uint8Array(await Bun.file(sparPath).arrayBuffer());
      const lazBytes = new Uint8Array(await Bun.file(lazPath).arrayBuffer());

      const sparMaterial = await readMaterial(sparBytes);
      const lazMaterial = await readMaterial(lazBytes);

      compareMaterialMeta(name, sparMaterial, lazMaterial);
      comparePassByName(name, sparMaterial.passes, lazMaterial.passes);
    } catch (err) {
      log(`\n  ${name}: Failed to parse — ${err}`);
    }
  }

  // ── Step 6: Lazurite unpack comparison ──────────────────────
  logSection("Unpacked JSON Comparison (via lazurite unpack)");

  for (const name of TARGET_MATERIALS) {
    const sparPath = join(SPAR_OUTPUT, `${name}.material.bin`);
    const lazPath = join(LAZURITE_OUTPUT, `${name}.material.bin`);

    const sparExists = await Bun.file(sparPath).exists();
    const lazExists = await Bun.file(lazPath).exists();
    if (!sparExists || !lazExists) continue;

    log(`\n  ${name}:`);
    try {
      await unpackAndCompare(name);
    } catch (err) {
      log(`    Unpack comparison failed: ${err}`);
    }
  }

  // ── Step 7: DXIL bytecode summary ──────────────────────────
  logSection("DXIL Bytecode Summary");

  for (const name of TARGET_MATERIALS) {
    const sparPath = join(SPAR_OUTPUT, `${name}.material.bin`);
    const lazPath = join(LAZURITE_OUTPUT, `${name}.material.bin`);

    const sparExists = await Bun.file(sparPath).exists();
    const lazExists = await Bun.file(lazPath).exists();
    if (!sparExists || !lazExists) continue;

    try {
      const sparBytes = new Uint8Array(await Bun.file(sparPath).arrayBuffer());
      const lazBytes = new Uint8Array(await Bun.file(lazPath).arrayBuffer());

      const sparMat = await readMaterial(sparBytes);
      const lazMat = await readMaterial(lazBytes);

      log(`\n  ${name}:`);

      for (const sparPass of sparMat.passes) {
        const lazPass = lazMat.passes.find(p => p.name === sparPass.name);
        if (!lazPass) continue;

        for (let vi = 0; vi < Math.min(sparPass.variants.length, lazPass.variants.length); vi++) {
          const sv = sparPass.variants[vi]!;
          const lv = lazPass.variants[vi]!;

          for (let si = 0; si < Math.min(sv.shaders.length, lv.shaders.length); si++) {
            const ss = sv.shaders[si]!;
            const ls = lv.shaders[si]!;

            const sparDxilLen = ss.bgfxShader.shaderBytes.length;
            const lazDxilLen = ls.bgfxShader.shaderBytes.length;
            const match = sparDxilLen === lazDxilLen &&
              ss.bgfxShader.shaderBytes.every((b, idx) => b === ls.bgfxShader.shaderBytes[idx]);

            const statusIcon = match ? "✓" : "✗";
            log(`    ${sparPass.name}[v${vi},s${si}]: spar=${sparDxilLen}B laz=${lazDxilLen}B ${statusIcon}`);

            if (!match && sparDxilLen > 0 && lazDxilLen > 0) {
              // Show first few bytes of DXIL header for debugging
              const sparHeader = Array.from(ss.bgfxShader.shaderBytes.slice(0, 16))
                .map(b => b.toString(16).padStart(2, "0")).join(" ");
              const lazHeader = Array.from(ls.bgfxShader.shaderBytes.slice(0, 16))
                .map(b => b.toString(16).padStart(2, "0")).join(" ");
              log(`      spar DXIL[0:16]: ${sparHeader}`);
              log(`      laz  DXIL[0:16]: ${lazHeader}`);
            }
          }
        }
      }
    } catch (err) {
      log(`  ${name}: ${err}`);
    }
  }

  // ── Summary ────────────────────────────────────────────────
  logSection("Summary");
  log(`  azure-spar output: ${SPAR_OUTPUT}`);
  log(`  Lazurite output:   ${LAZURITE_OUTPUT}`);
  log(`  Report:            ${REPORT_PATH}`);

  // Write report
  await Bun.write(REPORT_PATH, reportLines.join("\n"));
  log(`\n  Report written to ${REPORT_PATH}`);
}

main().catch((err) => {
  console.error("\nComparison failed:", err);
  process.exit(1);
});
