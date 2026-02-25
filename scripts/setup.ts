#!/usr/bin/env bun
/**
 * BetterRTX shader setup script.
 *
 * 1. Extracts HLSL source files from a provided archive (default: shader_source.tar.gz)
 * 2. Backs up base .material.bin files from Minecraft's renderer directory
 * 3. Extracts register binding defines (s_<name>_REG) from base materials
 * 4. Generates shaders/manifest.json
 *
 * Usage:
 *   bun run scripts/setup.ts [--archive path/to/archive.tar.gz] [--materials path/to/materials]
 *   bun run scripts/setup.ts --skip-materials [--archive path/to/archive.tar.gz]
 */

import { resolve, dirname, extname, join } from "node:path";
import { mkdir, copyFile, access } from "node:fs/promises";
import { readMaterial } from "../src/material/material.ts";
import { extractRegisterDefines } from "../src/betterrtx/register-bindings.ts";
import {
  parseMaterialConfig,
  parseProjectConfig,
  discoverMaterials,
  buildManifestFromConfig,
  type MaterialConfig,
  type ProjectConfig,
} from "../src/betterrtx/config.ts";
import type { MaterialManifest } from "../src/betterrtx/manifest-types.ts";

// ── Constants ────────────────────────────────────────────────────

const PROJECT_ROOT = resolve(import.meta.dir, "..");
const DEFAULT_ARCHIVE = resolve(PROJECT_ROOT, "shader_source.tar.gz");
const SHADERS_DIR = resolve(PROJECT_ROOT, "shaders");
const BACKUP_DIR = resolve(PROJECT_ROOT, "materials-backup");
const REGISTER_BINDINGS_PATH = resolve(SHADERS_DIR, "register-bindings.json");
const MANIFEST_JSON_PATH = resolve(SHADERS_DIR, "manifest.json");

const ARCHIVE_PREFIX = "shader_source/";

// Material names that BetterRTX modifies
const TARGET_MATERIALS = [
  "RTXStub",
  "RTXPostFX.Tonemapping",
  "RTXPostFX.Bloom",
] as const;

// ── CLI argument parsing ─────────────────────────────────────────

function getArg(flag: string): string | undefined {
  const idx = Bun.argv.indexOf(flag);
  if (idx === -1) return undefined;
  return Bun.argv[idx + 1];
}

// ── Prompt for materials directory ───────────────────────────────

async function promptMaterialsDir(): Promise<string> {
  const fromArg = getArg("--materials");
  if (fromArg) return resolve(fromArg);

  const fromEnv = process.env["MINECRAFT_MATERIALS_PATH"];
  if (fromEnv) return resolve(fromEnv);

  console.log("\nMinecraft renderer materials directory needed.");
  console.log("This contains .material.bin files used as base for BetterRTX.");

  const response = prompt("Enter materials directory path:");
  if (!response?.trim()) {
    throw new Error("Materials directory is required. Pass --materials or set MINECRAFT_MATERIALS_PATH.");
  }

  return resolve(response.trim());
}

async function validateMaterialsDir(dir: string): Promise<void> {
  try {
    await access(dir);
  } catch {
    throw new Error(`Materials directory not found: ${dir}`);
  }

  // Check at least one target material exists
  let found = 0;
  for (const name of TARGET_MATERIALS) {
    try {
      await access(join(dir, `${name}.material.bin`));
      found++;
    } catch {
      // Not all materials are required
    }
  }

  if (found === 0) {
    throw new Error(
      `No target .material.bin files found in: ${dir}\n` +
      `Expected: ${TARGET_MATERIALS.map((n) => `${n}.material.bin`).join(", ")}`,
    );
  }
}

// ── Material backup and register extraction ──────────────────────

async function backupAndExtractRegisters(
  materialsDir: string,
): Promise<Readonly<Record<string, Readonly<Record<string, string>>>>> {
  await mkdir(BACKUP_DIR, { recursive: true });

  const allBindings: Record<string, Readonly<Record<string, string>>> = {};

  for (const name of TARGET_MATERIALS) {
    const srcPath = join(materialsDir, `${name}.material.bin`);
    const backupPath = join(BACKUP_DIR, `${name}.material.bin`);

    try {
      await access(srcPath);
    } catch {
      console.log(`  Skipping ${name}.material.bin (not found)`);
      continue;
    }

    // Backup
    await copyFile(srcPath, backupPath);
    console.log(`  Backed up: ${name}.material.bin`);

    // Read and extract register bindings
    const data = await Bun.file(srcPath).arrayBuffer();
    const material = await readMaterial(new Uint8Array(data));
    const defines = extractRegisterDefines(material);

    allBindings[name] = defines;
    console.log(`  Extracted ${Object.keys(defines).length} register bindings from ${name}`);
  }

  return allBindings;
}

// ── Archive loading ──────────────────────────────────────────────

async function loadArchive(
  archivePath: string,
): Promise<Map<string, Uint8Array>> {
  const bytes = await Bun.file(archivePath).bytes();
  const archive = new Bun.Archive(bytes);
  const files = await archive.files();

  const result = new Map<string, Uint8Array>();
  for (const [path, blob] of files) {
    const buffer = await blob.arrayBuffer();
    result.set(path, new Uint8Array(buffer));
  }
  return result;
}

// ── Extract shader files ─────────────────────────────────────────

function collectShaderFiles(
  archiveFiles: Map<string, Uint8Array>,
  materialNames: readonly string[],
): Map<string, Uint8Array> {
  const shaderFiles = new Map<string, Uint8Array>();

  for (const [archivePath, content] of archiveFiles) {
    if (!archivePath.startsWith(ARCHIVE_PREFIX)) continue;

    const relative = archivePath.slice(ARCHIVE_PREFIX.length);

    const dirName = relative.split("/")[0];
    if (!dirName || !materialNames.includes(dirName)) continue;

    const ext = extname(relative).toLowerCase();
    if (![".hlsl", ".hlsli", ".h"].includes(ext)) continue;

    shaderFiles.set(relative, content);
  }

  return shaderFiles;
}

async function writeShaderFiles(
  shaderFiles: Map<string, Uint8Array>,
): Promise<void> {
  for (const [relative, content] of shaderFiles) {
    const outPath = resolve(SHADERS_DIR, relative);
    await mkdir(dirname(outPath), { recursive: true });
    await Bun.write(outPath, content);
  }
}

// ── Parse configs from archive ───────────────────────────────────

function parseConfigsFromArchive(
  archiveFiles: Map<string, Uint8Array>,
  materialNames: readonly string[],
): {
  project: ProjectConfig | null;
  materials: Map<string, MaterialConfig>;
  manifests: MaterialManifest[];
} {
  const decoder = new TextDecoder("utf-8");

  const projectBytes = archiveFiles.get(`${ARCHIVE_PREFIX}project.json`);
  const project = projectBytes
    ? parseProjectConfig(decoder.decode(projectBytes))
    : null;

  const materials = new Map<string, MaterialConfig>();
  const manifests: MaterialManifest[] = [];

  for (const name of materialNames) {
    const configBytes = archiveFiles.get(
      `${ARCHIVE_PREFIX}${name}/config.json`,
    );
    if (!configBytes) continue;

    const config = parseMaterialConfig(decoder.decode(configBytes));
    materials.set(name, config);

    const manifest = buildManifestFromConfig(name, config);
    manifests.push(manifest);
  }

  return { project, materials, manifests };
}

// ── Main ─────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const archivePath = getArg("--archive")
    ? resolve(getArg("--archive")!)
    : DEFAULT_ARCHIVE;
  const skipMaterials = Bun.argv.includes("--skip-materials");

  console.log("=== BetterRTX Shader Setup ===\n");

  // ── Step 1–2: Backup materials and extract register bindings ───
  let registerBindings: Readonly<Record<string, Readonly<Record<string, string>>>> = {};

  if (skipMaterials) {
    console.log("Skipping materials backup (--skip-materials)");
    // Use existing register-bindings.json if available
    try {
      registerBindings = await Bun.file(REGISTER_BINDINGS_PATH).json();
      console.log(`Using existing register bindings: ${REGISTER_BINDINGS_PATH}`);
    } catch {
      console.log("No existing register-bindings.json found (register bindings will be empty)");
    }
  } else {
    const materialsDir = await promptMaterialsDir();
    await validateMaterialsDir(materialsDir);
    console.log(`\nMaterials directory: ${materialsDir}`);

    console.log("\nBacking up base materials...");
    registerBindings = await backupAndExtractRegisters(materialsDir);

    // Write register bindings for use during compilation
    await mkdir(SHADERS_DIR, { recursive: true });
    await Bun.write(
      REGISTER_BINDINGS_PATH,
      JSON.stringify(registerBindings, null, 2),
    );
    console.log(`\nRegister bindings saved: ${REGISTER_BINDINGS_PATH}`);
  }

  // ── Step 3: Extract BetterRTX shaders from archive ─────────────
  console.log(`\nLoading archive: ${archivePath}`);
  const archiveFiles = await loadArchive(archivePath);
  console.log(`  Found ${archiveFiles.size} files in archive`);

  const materialNames = discoverMaterials(
    [...archiveFiles.keys()],
    ARCHIVE_PREFIX,
  );
  console.log(`  Materials: ${materialNames.join(", ")}`);

  const { manifests } = parseConfigsFromArchive(archiveFiles, materialNames);

  const totalShaders = manifests.reduce(
    (sum, m) => sum + m.shaders.length,
    0,
  );
  console.log(`  Total shader entries: ${totalShaders}`);

  const shaderFiles = collectShaderFiles(archiveFiles, materialNames);
  console.log(`\nExtracting ${shaderFiles.size} shader files to shaders/`);
  await writeShaderFiles(shaderFiles);

  // Extract data.hlsl reference (generated by lazurite, documents all register declarations)
  const dataHlsl = archiveFiles.get(`${ARCHIVE_PREFIX}data.hlsl`);
  if (dataHlsl) {
    await Bun.write(resolve(SHADERS_DIR, "data.hlsl"), dataHlsl);
    console.log("  Extracted data.hlsl reference");
  }

  // ── Step 4: Generate manifest.json ──────────────────────────────
  console.log(`\nGenerating ${MANIFEST_JSON_PATH}`);
  await Bun.write(MANIFEST_JSON_PATH, JSON.stringify(manifests, null, 2));

  // ── Summary ────────────────────────────────────────────────────
  console.log("\n=== Setup Complete ===\n");
  console.log("Materials:");
  for (const manifest of manifests) {
    const bindings = registerBindings[manifest.materialName];
    const regCount = bindings ? Object.keys(bindings).length : 0;
    console.log(
      `  ${manifest.materialName}: ${manifest.shaders.length} passes, ${regCount} register bindings`,
    );
  }
  if (!skipMaterials) {
    console.log(`\nBackups saved to: ${BACKUP_DIR}`);
  }
  console.log("Run 'bun run scripts/test-dxc.ts' to verify DXC compilation.");
}

main().catch((err) => {
  console.error("\nSetup failed:", err);
  process.exit(1);
});
