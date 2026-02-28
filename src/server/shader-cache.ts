/**
 * Lazy-loaded shader data cache.
 *
 * On first call, loads shader manifests, register bindings, and source
 * files. Supports two modes:
 *
 * 1. **Directory mode** — when `<shadersVolume>/manifest.json` exists,
 *    reads the pre-built manifest and shader files directly from the
 *    filesystem. Ideal for Docker / Cloudflare Containers where shader
 *    data is baked into the image.
 *
 * 2. **Archive mode** — reads `shader_source.tar.gz` from the volume,
 *    discovers materials via `config.json` entries, and extracts files.
 *    Original mode used by the local Docker Compose setup.
 *
 * All subsequent calls return the cached result.
 */

import { resolve, dirname, extname, relative, join } from "node:path";
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
import { TARGET_MATERIALS, type ShaderData } from "./types.ts";
import { ShaderDataError } from "./errors.ts";

type RegisterBindingsMap = Record<string, Readonly<Record<string, string>>>;

let _shaderData: ShaderData | null = null;
let _shaderDataKey: string | null = null;

/**
 * Load and cache shader manifests, register bindings, and source files.
 *
 * Validates that subsequent calls use the same (shadersVolume, archivePrefix)
 * arguments. If different arguments are passed while data is already cached,
 * throws an error — call resetShaderCache() first to reload.
 */
export async function loadShaderData(
  shadersVolume: string,
  archivePrefix: string,
): Promise<ShaderData> {
  const key = `${shadersVolume}::${archivePrefix}`;

  if (_shaderData && _shaderDataKey === key) return _shaderData;

  if (_shaderData && _shaderDataKey !== key) {
    throw new ShaderDataError(
      `Shader data already loaded from "${_shaderDataKey}", ` +
        `cannot reload from "${key}". Call resetShaderCache() first.`,
    );
  }

  try {
    // Try directory mode first (pre-built manifest.json + extracted shaders),
    // then fall back to archive mode (shader_source.tar.gz).
    const manifestPath = resolve(shadersVolume, "manifest.json");
    const hasManifest = await Bun.file(manifestPath).exists();

    _shaderData = hasManifest
      ? await loadShaderDataFromDirectory(shadersVolume)
      : await loadShaderDataFromVolume(shadersVolume, archivePrefix);

    _shaderDataKey = key;
    return _shaderData;
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
    const exists = await Bun.file(join(materialDir, ".")).exists().catch(() => false);
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
  const tempShadersRoot = resolve(tmpdir(), "azure-spar-shaders");
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

  console.log(
    `[Server] Directory mode: loaded ${manifests.length} manifests, ` +
      `${shaderFiles.size} shader files, ` +
      `${Object.keys(registerBindings).length} register binding sets`,
  );

  return { manifests, registerBindings, shaderFiles, tempShadersRoot };
}

// ── Archive Mode ────────────────────────────────────────────────

async function loadShaderDataFromVolume(
  shadersVolume: string,
  archivePrefix: string,
): Promise<ShaderData> {
  // 1. Load archive
  const archivePath = resolve(shadersVolume, "shader_source.tar.gz");
  const archiveBytes = await Bun.file(archivePath).bytes();
  const archive = new Bun.Archive(archiveBytes);
  const archiveEntries = await archive.files();

  const archiveFiles = new Map<string, Uint8Array>();
  for (const [path, blob] of archiveEntries) {
    archiveFiles.set(path, new Uint8Array(await blob.arrayBuffer()));
  }

  // 2. Discover materials (auto-detect prefix if configured one finds nothing)
  const archivePaths = [...archiveFiles.keys()];
  let effectivePrefix = archivePrefix;
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
      `No materials found with prefix "${archivePrefix}". ` +
        `Archive top-level: [${topDirs.join(", ")}]. ` +
        `Expected paths like "${archivePrefix}<MaterialName>/config.json".`,
    );
  }
  const decoder = new TextDecoder("utf-8");
  const manifests = materialNames.flatMap((name) => {
    const configBytes = archiveFiles.get(
      `${effectivePrefix}${name}/config.json`,
    );
    if (!configBytes) return [];
    const config = parseMaterialConfig(decoder.decode(configBytes));
    return [buildManifestFromConfig(name, config)];
  });

  // 3. Collect shader source files
  const shaderFiles = new Map<string, Uint8Array>();
  for (const [archPath, content] of archiveFiles) {
    if (!archPath.startsWith(effectivePrefix)) continue;
    const relative = archPath.slice(effectivePrefix.length);
    const dir = relative.split("/")[0];
    if (!dir || !materialNames.includes(dir)) continue;
    const ext = extname(relative).toLowerCase();
    if ([".hlsl", ".hlsli", ".h"].includes(ext)) {
      shaderFiles.set(relative, content);
    }
  }

  // 4. Load register bindings (try vanilla .material.bin, fall back to JSON)
  const registerBindings: Record<string, Readonly<Record<string, string>>> =
    await loadRegisterBindings(shadersVolume);

  // 5. Write shader sources to temp for DXC #include resolution
  const tempShadersRoot = resolve(tmpdir(), "azure-spar-shaders");
  await mkdir(tempShadersRoot, { recursive: true });

  for (const [relative, content] of shaderFiles) {
    const outPath = resolve(tempShadersRoot, relative);

    // Guard against path traversal from malicious archive entries
    if (!outPath.startsWith(tempShadersRoot)) {
      throw new ShaderDataError(
        `Archive contains path traversal: "${relative}"`,
      );
    }

    await mkdir(dirname(outPath), { recursive: true });
    await Bun.write(outPath, content);
  }

  console.log(
    `[Server] Loaded ${manifests.length} manifests, ${shaderFiles.size} shader files, ` +
      `${Object.keys(registerBindings).length} register binding sets`,
  );

  return { manifests, registerBindings, shaderFiles, tempShadersRoot };
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
 * Returns e.g. "brtx_lazurite-main/" if entries contain "brtx_lazurite-main/RTXStub/config.json".
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
  if (_shaderData?.tempShadersRoot) {
    try {
      await rm(_shaderData.tempShadersRoot, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup
    }
  }
  _shaderData = null;
  _shaderDataKey = null;
}
