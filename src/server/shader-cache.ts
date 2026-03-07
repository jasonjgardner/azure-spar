/**
 * Lazy-loaded shader data cache.
 *
 * On first call, loads shader manifests, register bindings, and source
 * files. Supports three modes:
 *
 * 1. **Directory mode** — when `<shadersVolume>/manifest.json` exists,
 *    reads the pre-built manifest and shader files directly from the
 *    filesystem. Ideal for Docker / Cloudflare Containers where shader
 *    data is baked into the image.
 *
 * 2. **Named archive mode** — reads `<prefix>-<version>.tar.gz`
 *    from the shaders volume root. Used for versioned shader archives.
 *
 * 3. **Archive mode** — reads `shader_source.tar.gz` from the volume,
 *    discovers materials via `config.json` entries, and extracts files.
 *    Original mode used by the local Docker Compose setup.
 *
 * All subsequent calls return the cached result.
 */

import { resolve, dirname, extname, join } from "node:path";
import { mkdir, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { readMaterial } from "../material/material.ts";
import { extractRegisterDefines } from "../betterrtx/register-bindings.ts";
import {
  parseMaterialConfig,
  discoverMaterials,
  buildManifestFromConfig,
} from "../betterrtx/config.ts";
import type { MaterialManifest } from "../betterrtx/manifest-types.ts";
import { TARGET_MATERIALS, DEFAULT_VERSION_ID, type ShaderData } from "./types.ts";
import { ShaderDataError } from "./errors.ts";
import { getVersionPath, getVersionArchivePath } from "./versions.ts";

type RegisterBindingsMap = Record<string, Readonly<Record<string, string>>>;

/** Version-keyed shader data cache. Each version's data is loaded once and reused. */
const _shaderDataMap = new Map<string, ShaderData>();

/**
 * Load and cache shader manifests, register bindings, and source files.
 *
 * Supports multi-version loading: each (volume, prefix, version) combination
 * is cached independently. The "default" version loads from the root volume
 * (backward compatible with the flat layout).
 *
 * @param shadersVolume - Root path containing shader data
 * @param archivePrefix - Prefix path inside tar.gz archives
 * @param version - Version ID (defaults to "default" for flat layout)
 */
export async function loadShaderData(
  shadersVolume: string,
  archivePrefix: string,
  version: string = DEFAULT_VERSION_ID,
): Promise<ShaderData> {
  const cacheKey = `${shadersVolume}::${archivePrefix}::${version}`;

  const cached = _shaderDataMap.get(cacheKey);
  if (cached) return cached;

  try {
    // Use version-specific temp directory to avoid collisions
    const tempSuffix = version === DEFAULT_VERSION_ID ? "" : `-${version}`;

    // 1. Check for a named versioned archive
    const namedArchivePath = await getVersionArchivePath(shadersVolume, version);
    if (namedArchivePath) {
      const shaderData = await loadShaderDataFromArchive(
        namedArchivePath,
        shadersVolume,
        tempSuffix,
      );
      _shaderDataMap.set(cacheKey, shaderData);
      console.log(
        `[Server] Cached shader data for version "${version}" (named archive)`,
      );
      return shaderData;
    }

    // 2. Resolve the version directory for directory/volume modes
    const versionPath = getVersionPath(shadersVolume, version);

    // 3. Try directory mode (pre-built manifest.json + extracted shaders)
    const manifestPath = resolve(versionPath, "manifest.json");
    const hasManifest = await Bun.file(manifestPath).exists();

    const shaderData = hasManifest
      ? await loadShaderDataFromDirectory(versionPath, tempSuffix)
      : await loadShaderDataFromVolume(versionPath, archivePrefix, tempSuffix);

    _shaderDataMap.set(cacheKey, shaderData);
    console.log(`[Server] Cached shader data for version "${version}"`);
    return shaderData;
  } catch (err) {
    if (err instanceof ShaderDataError) throw err;
    throw new ShaderDataError(
      err instanceof Error ? err.message : String(err),
    );
  }
}

// ── Directory Mode ──────────────────────────────────────────────

/**
 * Load shader data from a pre-extracted directory containing
 * manifest.json, register-bindings.json, and shader source files.
 *
 * Expected layout:
 * ```
 * <shadersVolume>/
 * ├── manifest.json                       (pre-built MaterialManifest[])
 * ├── register-bindings.json              (register slot defines per material)
 * ├── RTXStub/shaders/...                 (HLSL sources)
 * ├── RTXPostFX.Tonemapping/shaders/...
 * └── RTXPostFX.Bloom/shaders/...
 * ```
 */
async function loadShaderDataFromDirectory(
  shadersVolume: string,
  tempSuffix: string = "",
): Promise<ShaderData> {
  // 1. Load pre-built manifest
  const manifestPath = resolve(shadersVolume, "manifest.json");
  const manifests = (await Bun.file(manifestPath).json()) as MaterialManifest[];

  if (manifests.length === 0) {
    throw new ShaderDataError(
      `manifest.json at "${manifestPath}" is empty — no materials defined.`,
    );
  }

  // 2. Collect shader source files from material directories
  const shaderExts = new Set([".hlsl", ".hlsli", ".h"]);
  const shaderFiles = new Map<string, Uint8Array>();

  async function walkDir(dir: string, base: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const relPath = join(base, entry.name).replace(/\\/g, "/");

      if (entry.isDirectory()) {
        await walkDir(fullPath, relPath);
        continue;
      }

      if (!shaderExts.has(extname(entry.name).toLowerCase())) continue;
      shaderFiles.set(relPath, new Uint8Array(await Bun.file(fullPath).arrayBuffer()));
    }
  }

  // Walk each material directory for shader sources
  const materialNames = [
    ...new Set(manifests.map((m) => m.materialName)),
  ];
  for (const name of materialNames) {
    const materialDir = resolve(shadersVolume, name);
    // readdir will throw if directory doesn't exist — catch and skip
    try {
      await walkDir(materialDir, name);
    } catch {
      console.warn(`[Server] Material directory not found: ${materialDir}`);
    }
  }

  // Also collect top-level shared shader files (e.g. data.hlsl)
  try {
    const topEntries = await readdir(shadersVolume, { withFileTypes: true });
    for (const entry of topEntries) {
      if (entry.isDirectory()) continue;
      if (!shaderExts.has(extname(entry.name).toLowerCase())) continue;
      const fullPath = join(shadersVolume, entry.name);
      shaderFiles.set(entry.name, new Uint8Array(await Bun.file(fullPath).arrayBuffer()));
    }
  } catch {
    // Non-critical — shared files are optional
  }

  // 3. Load register bindings
  const registerBindings = await loadRegisterBindings(shadersVolume);

  // 4. Write shader sources to temp for DXC #include resolution
  const tempShadersRoot = resolve(tmpdir(), `azure-spar-shaders${tempSuffix}`);
  await mkdir(tempShadersRoot, { recursive: true });

  for (const [relativePath, content] of shaderFiles) {
    const outPath = resolve(tempShadersRoot, relativePath);

    if (!outPath.startsWith(tempShadersRoot)) {
      throw new ShaderDataError(
        `Shader path traversal detected: "${relativePath}"`,
      );
    }

    await mkdir(dirname(outPath), { recursive: true });
    await Bun.write(outPath, content);
  }

  // 5. Load vanilla .material.bin files for merge-based compilation
  const vanillaMaterials = await loadVanillaMaterials(shadersVolume);

  console.log(
    `[Server] Directory mode: loaded ${manifests.length} manifests, ` +
      `${shaderFiles.size} shader files, ` +
      `${Object.keys(registerBindings).length} register binding sets, ` +
      `${Object.keys(vanillaMaterials).length} vanilla materials`,
  );

  return { manifests, registerBindings, shaderFiles, tempShadersRoot, vanillaMaterials };
}

// ── Named Archive Mode ──────────────────────────────────────────

/**
 * Load shader data from a named archive file (e.g., `<prefix>-1.4.1.tar.gz`).
 * Auto-detects the internal prefix from the archive contents.
 */
async function loadShaderDataFromArchive(
  archivePath: string,
  shadersVolume: string,
  tempSuffix: string,
): Promise<ShaderData> {
  const archiveFiles = await readArchiveFiles(archivePath);
  return processArchiveContents(archiveFiles, shadersVolume, tempSuffix);
}

// ── Archive Mode (legacy shader_source.tar.gz) ─────────────────

async function loadShaderDataFromVolume(
  shadersVolume: string,
  archivePrefix: string,
  tempSuffix: string = "",
): Promise<ShaderData> {
  const archivePath = resolve(shadersVolume, "shader_source.tar.gz");
  const archiveFiles = await readArchiveFiles(archivePath);
  return processArchiveContents(
    archiveFiles,
    shadersVolume,
    tempSuffix,
    archivePrefix,
  );
}

// ── Shared Archive Processing ───────────────────────────────────

/** Read all files from a tar.gz archive into memory. */
async function readArchiveFiles(
  archivePath: string,
): Promise<ReadonlyMap<string, Uint8Array>> {
  const bytes = await Bun.file(archivePath).bytes();
  const archive = new Bun.Archive(bytes);
  const entries = await archive.files();

  const files = new Map<string, Uint8Array>();
  for (const [path, blob] of entries) {
    files.set(path, new Uint8Array(await blob.arrayBuffer()));
  }
  return files;
}

/**
 * Process archive contents into ShaderData.
 *
 * Discovers materials, extracts manifests and shader sources,
 * writes to temp for DXC #include resolution.
 *
 * @param hintPrefix - Optional prefix hint (from config). Auto-detected if empty or no match.
 */
async function processArchiveContents(
  archiveFiles: ReadonlyMap<string, Uint8Array>,
  shadersVolume: string,
  tempSuffix: string,
  hintPrefix?: string,
): Promise<ShaderData> {
  const archivePaths = [...archiveFiles.keys()];

  // Determine effective prefix (auto-detect if hint doesn't match)
  let effectivePrefix = hintPrefix ?? "";
  let materialNames = discoverMaterials(archivePaths, effectivePrefix);

  if (materialNames.length === 0) {
    const detected = detectArchivePrefix(archivePaths);
    if (detected && detected !== effectivePrefix) {
      console.log(
        `[Server] Archive prefix "${effectivePrefix}" matched 0 materials. ` +
          `Auto-detected prefix "${detected}" from archive contents.`,
      );
      effectivePrefix = detected;
      materialNames = discoverMaterials(archivePaths, effectivePrefix);
    }
  }

  if (materialNames.length === 0) {
    const topDirs = [
      ...new Set(archivePaths.map((p) => p.split("/")[0]).filter(Boolean)),
    ];
    throw new ShaderDataError(
      `No materials found in archive. ` +
        `Top-level: [${topDirs.join(", ")}]. ` +
        `Expected paths like "<prefix>/<MaterialName>/config.json".`,
    );
  }

  // Build manifests from config.json files
  const decoder = new TextDecoder("utf-8");
  const manifests = materialNames.flatMap((name) => {
    const configBytes = archiveFiles.get(
      `${effectivePrefix}${name}/config.json`,
    );
    if (!configBytes) return [];
    const config = parseMaterialConfig(decoder.decode(configBytes));
    return [buildManifestFromConfig(name, config)];
  });

  // Collect shader source files
  const shaderExts = new Set([".hlsl", ".hlsli", ".h"]);
  const shaderFiles = new Map<string, Uint8Array>();
  for (const [archPath, content] of archiveFiles) {
    if (!archPath.startsWith(effectivePrefix)) continue;
    const relative = archPath.slice(effectivePrefix.length);
    const dir = relative.split("/")[0];
    if (!dir || !materialNames.includes(dir)) continue;
    if (!shaderExts.has(extname(relative).toLowerCase())) continue;
    shaderFiles.set(relative, content);
  }

  // Load register bindings (vanilla .material.bin or register-bindings.json)
  const registerBindings = await loadRegisterBindings(shadersVolume);

  // Write shader sources to temp for DXC #include resolution
  const tempShadersRoot = resolve(tmpdir(), `azure-spar-shaders${tempSuffix}`);
  await mkdir(tempShadersRoot, { recursive: true });

  for (const [relativePath, content] of shaderFiles) {
    const outPath = resolve(tempShadersRoot, relativePath);

    if (!outPath.startsWith(tempShadersRoot)) {
      throw new ShaderDataError(
        `Archive contains path traversal: "${relativePath}"`,
      );
    }

    await mkdir(dirname(outPath), { recursive: true });
    await Bun.write(outPath, content);
  }

  // Load vanilla .material.bin files for merge-based compilation
  const vanillaMaterials = await loadVanillaMaterials(shadersVolume);

  console.log(
    `[Server] Archive mode: ${manifests.length} manifests, ${shaderFiles.size} shader files, ` +
      `${Object.keys(registerBindings).length} register binding sets, ` +
      `${Object.keys(vanillaMaterials).length} vanilla materials`,
  );

  return { manifests, registerBindings, shaderFiles, tempShadersRoot, vanillaMaterials };
}

// ── Vanilla Material Loading ────────────────────────────────────

/**
 * Load vanilla .material.bin files from the vanilla/ subdirectory.
 * These are used as merge bases for compilation.
 *
 * Without vanilla materials, the compiler cannot produce functional
 * .material.bin files — the output would lack buffers, uniforms,
 * encryption, and pass metadata from the base game.
 */
async function loadVanillaMaterials(
  shadersVolume: string,
): Promise<Readonly<Record<string, Uint8Array>>> {
  const vanillaDir = resolve(shadersVolume, "vanilla");
  const materials: Record<string, Uint8Array> = {};

  for (const name of TARGET_MATERIALS) {
    const path = resolve(vanillaDir, `${name}.material.bin`);
    const file = Bun.file(path);
    if (!(await file.exists())) continue;

    try {
      materials[name] = new Uint8Array(await file.arrayBuffer());
    } catch (err) {
      console.warn(`[Server] Failed to load vanilla material ${name}: ${err}`);
    }
  }

  const loaded = Object.keys(materials).length;
  const expected = TARGET_MATERIALS.length;

  if (loaded === 0) {
    throw new ShaderDataError(
      `No vanilla .material.bin files found in "${vanillaDir}". ` +
        `These are required for compilation. Expected files: ${TARGET_MATERIALS.map(n => `${n}.material.bin`).join(", ")}`,
    );
  }

  if (loaded < expected) {
    const missing = TARGET_MATERIALS.filter((n) => !(n in materials));
    console.warn(
      `[Server] Missing vanilla materials (${loaded}/${expected}): ${missing.join(", ")}. ` +
        `Builds for missing materials will fail.`,
    );
  }

  return materials;
}

/**
 * Load register bindings from vanilla .material.bin files, falling back to
 * register-bindings.json if vanilla materials are not available.
 *
 * RTXPostFX materials need register slot defines (e.g. s_RasterColor_REG=0)
 * that are extracted from the base game's compiled materials. Without these,
 * HLSL CONCAT macros produce invalid register expressions.
 */
async function loadRegisterBindings(
  shadersVolume: string,
): Promise<RegisterBindingsMap> {
  const registerBindings: RegisterBindingsMap = {};
  const vanillaDir = resolve(shadersVolume, "vanilla");
  let loadedFromVanilla = false;

  for (const name of TARGET_MATERIALS) {
    const vanillaPath = resolve(vanillaDir, `${name}.material.bin`);
    const file = Bun.file(vanillaPath);
    if (!(await file.exists())) continue;

    try {
      const data = new Uint8Array(await file.arrayBuffer());
      const material = await readMaterial(data);
      registerBindings[name] = extractRegisterDefines(material);
      loadedFromVanilla = true;
    } catch (err) {
      console.warn(
        `[Server] Failed to extract register bindings from ${name}: ${err}`,
      );
    }
  }

  if (loadedFromVanilla) return registerBindings;

  // Fallback: load from pre-extracted register-bindings.json
  // Try both <shadersVolume>/register-bindings.json (directory mode)
  // and <shadersVolume>/shaders/register-bindings.json (archive mode)
  const candidatePaths = [
    resolve(shadersVolume, "register-bindings.json"),
    resolve(shadersVolume, "shaders", "register-bindings.json"),
  ];

  for (const jsonPath of candidatePaths) {
    const jsonFile = Bun.file(jsonPath);
    if (!(await jsonFile.exists())) continue;

    try {
      const parsed = (await jsonFile.json()) as RegisterBindingsMap;
      console.log(
        `[Server] Loaded register bindings from ${jsonPath} (${Object.keys(parsed).length} materials)`,
      );
      return parsed;
    } catch (err) {
      console.warn(
        `[Server] Failed to parse register-bindings.json at ${jsonPath}: ${err}`,
      );
    }
  }

  console.warn(
    `[Server] No register bindings found. RTXPostFX materials will likely fail to compile. ` +
      `Provide vanilla/ .material.bin files or shaders/register-bindings.json.`,
  );
  return registerBindings;
}

/**
 * Auto-detect the archive prefix by finding the common parent of config.json files.
 * Returns the common prefix directory (e.g. "pack-main/") by finding the first config.json entry.
 */
function detectArchivePrefix(paths: readonly string[]): string | null {
  for (const path of paths) {
    if (!path.endsWith("/config.json")) continue;
    // "prefix/MaterialName/config.json" → "prefix/"
    const parts = path.split("/");
    if (parts.length === 3) {
      return `${parts[0]}/`;
    }
  }
  return null;
}

/**
 * Reset cached shader data and clean up temp files.
 * Call on server shutdown or before reloading with different config.
 */
export async function resetShaderCache(): Promise<void> {
  for (const data of _shaderDataMap.values()) {
    if (data.tempShadersRoot) {
      try {
        await rm(data.tempShadersRoot, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup
      }
    }
  }
  _shaderDataMap.clear();
}
