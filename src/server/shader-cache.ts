/**
 * Lazy-loaded shader data cache.
 *
 * On first call, loads the shader source archive, discovers material
 * manifests, extracts register bindings from vanilla materials, and
 * writes shader files to a temp directory for DXC #include resolution.
 *
 * All subsequent calls return the cached result.
 */

import { resolve, dirname, extname } from "node:path";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { readMaterial } from "../material/material.ts";
import { extractRegisterDefines } from "../betterrtx/register-bindings.ts";
import {
  parseMaterialConfig,
  discoverMaterials,
  buildManifestFromConfig,
} from "../betterrtx/config.ts";
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
    _shaderData = await loadShaderDataFromVolume(shadersVolume, archivePrefix);
    _shaderDataKey = key;
    return _shaderData;
  } catch (err) {
    if (err instanceof ShaderDataError) throw err;
    throw new ShaderDataError(
      err instanceof Error ? err.message : String(err),
    );
  }
}

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
  const jsonPath = resolve(shadersVolume, "shaders", "register-bindings.json");
  const jsonFile = Bun.file(jsonPath);
  if (await jsonFile.exists()) {
    try {
      const parsed = (await jsonFile.json()) as RegisterBindingsMap;
      console.log(
        `[Server] Loaded register bindings from ${jsonPath} (${Object.keys(parsed).length} materials)`,
      );
      return parsed;
    } catch (err) {
      console.warn(
        `[Server] Failed to parse register-bindings.json: ${err}`,
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
