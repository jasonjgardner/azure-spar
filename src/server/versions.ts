/**
 * Version discovery and management for multi-version BetterRTX support.
 *
 * Supports four discovery modes (tried in order):
 *
 * 1. **Manifest mode** — `<shadersVolume>/versions.json` explicitly lists
 *    available versions with labels and default designation.
 *
 * 2. **Auto-discovery mode** — scans `<shadersVolume>/` for subdirectories
 *    containing a `manifest.json` or `config.json` (shader data marker).
 *
 * 3. **Named archive mode** — scans for `<prefix>-*.tar.gz` files in
 *    the shaders volume root. Version ID is extracted from the filename.
 *
 * 4. **Single-version fallback** — when the root volume itself contains
 *    `manifest.json` (current flat layout), synthesizes a single "default"
 *    version pointing at the root. Fully backward compatible.
 */

import { resolve } from "node:path";
import { readdir } from "node:fs/promises";
import type { RawSettings } from "../betterrtx/settings.ts";
import type { FormConfig } from "./form-types.ts";
import { TARGET_MATERIALS } from "./types.ts";
import {
  parseSettingsHlsl,
  type ParsedSettingsResult,
} from "../betterrtx/settings-parser.ts";

// ── Types ────────────────────────────────────────────────────────

export interface VersionInfo {
  readonly id: string;
  readonly label: string;
  readonly isDefault: boolean;
}

export interface VersionsManifest {
  readonly versions: readonly VersionInfo[];
  readonly defaultVersion: string;
}

/** Raw versions.json file format. */
interface VersionsJsonEntry {
  readonly id: string;
  readonly label?: string;
  readonly default?: boolean;
}

// ── Constants ────────────────────────────────────────────────────

const DEFAULT_VERSION_ID = "default";

/**
 * Matches any `.tar.gz` whose filename ends with a version number.
 * e.g. `my-pack-1.4.1.tar.gz` → capture group "1.4.1"
 *
 * Version must be at least two numeric segments separated by dots (e.g. 1.0, 1.4.1).
 */
const VERSIONED_ARCHIVE_RE = /^.+-(\d+(?:\.\d+)+)\.tar\.gz$/;

/** Only allow safe characters in version IDs (alphanumeric, dots, hyphens, underscores). */
const SAFE_VERSION_ID_RE = /^[a-zA-Z0-9._-]+$/;

function assertSafeVersionId(versionId: string): void {
  if (versionId === DEFAULT_VERSION_ID) return;
  if (!SAFE_VERSION_ID_RE.test(versionId)) {
    throw new Error(`Invalid version ID: "${versionId}"`);
  }
}

// ── Discovery ────────────────────────────────────────────────────

/**
 * Discover available shader versions from the shaders volume.
 *
 * Caches the result after first successful discovery.
 */
let _cachedManifest: VersionsManifest | null = null;

/** Maps version ID → full archive file path (populated during discovery). */
const _archivePathMap = new Map<string, string>();

export async function discoverVersions(
  shadersVolume: string,
): Promise<VersionsManifest> {
  if (_cachedManifest) return _cachedManifest;

  // 1. Try explicit versions.json
  const versionsJsonPath = resolve(shadersVolume, "versions.json");
  const versionsFile = Bun.file(versionsJsonPath);
  if (await versionsFile.exists()) {
    try {
      const entries = (await versionsFile.json()) as readonly VersionsJsonEntry[];
      const manifest = parseVersionsJson(entries);
      _cachedManifest = manifest;
      console.log(
        `[Versions] Loaded ${manifest.versions.length} versions from versions.json ` +
          `(default: ${manifest.defaultVersion})`,
      );
      return manifest;
    } catch (err) {
      console.warn(`[Versions] Failed to parse versions.json: ${err}`);
    }
  }

  // 2. Auto-discover version subdirectories
  const autoDiscovered = await autoDiscoverVersions(shadersVolume);
  if (autoDiscovered.versions.length > 0) {
    _cachedManifest = autoDiscovered;
    console.log(
      `[Versions] Auto-discovered ${autoDiscovered.versions.length} versions ` +
        `(default: ${autoDiscovered.defaultVersion})`,
    );
    return autoDiscovered;
  }

  // 3. Discover named archives (<prefix>-*.tar.gz)
  const archiveDiscovered = await discoverVersionsFromArchives(shadersVolume);
  if (archiveDiscovered.versions.length > 0) {
    _cachedManifest = archiveDiscovered;
    console.log(
      `[Versions] Discovered ${archiveDiscovered.versions.length} versions from named archives ` +
        `(default: ${archiveDiscovered.defaultVersion})`,
    );
    return archiveDiscovered;
  }

  // 4. Flat layout fallback — single "default" version
  const rootManifest = resolve(shadersVolume, "manifest.json");
  const hasRootManifest = await Bun.file(rootManifest).exists();
  const rootArchive = resolve(shadersVolume, "shader_source.tar.gz");
  const hasRootArchive = await Bun.file(rootArchive).exists();

  if (hasRootManifest || hasRootArchive) {
    const manifest: VersionsManifest = {
      versions: [{ id: DEFAULT_VERSION_ID, label: "BetterRTX", isDefault: true }],
      defaultVersion: DEFAULT_VERSION_ID,
    };
    _cachedManifest = manifest;
    console.log("[Versions] Single-version fallback (flat layout)");
    return manifest;
  }

  // No versions found at all
  const manifest: VersionsManifest = {
    versions: [],
    defaultVersion: DEFAULT_VERSION_ID,
  };
  _cachedManifest = manifest;
  console.warn("[Versions] No shader versions found in volume");
  return manifest;
}

/**
 * Resolve the filesystem path for a version's shader data.
 *
 * - "default" version → root of shadersVolume (flat layout)
 * - Named versions → `<shadersVolume>/<versionId>/`
 */
export function getVersionPath(
  shadersVolume: string,
  versionId: string,
): string {
  assertSafeVersionId(versionId);
  if (versionId === DEFAULT_VERSION_ID) return shadersVolume;
  return resolve(shadersVolume, versionId);
}

/**
 * Resolve the archive file path for a named-archive version.
 * Checks the discovery cache first, then scans the directory as fallback.
 */
export async function getVersionArchivePath(
  shadersVolume: string,
  versionId: string,
): Promise<string | null> {
  assertSafeVersionId(versionId);
  if (versionId === DEFAULT_VERSION_ID) return null;

  // 1. Check cached path from discovery
  const cached = _archivePathMap.get(versionId);
  if (cached) return cached;

  // 2. Scan directory for any archive ending with this version
  try {
    const entries = await readdir(shadersVolume, { withFileTypes: true });
    const suffix = `-${versionId}.tar.gz`;
    for (const entry of entries) {
      if (entry.isDirectory()) continue;
      if (entry.name.endsWith(suffix)) {
        const fullPath = resolve(shadersVolume, entry.name);
        _archivePathMap.set(versionId, fullPath);
        return fullPath;
      }
    }
  } catch {
    // readdir failed
  }

  return null;
}

/**
 * Load the form configuration for a specific version.
 *
 * Resolution order:
 * 1. Explicit `form.json` in the version directory
 * 2. Auto-generated from Settings.hlsl inside the version's archive
 */
export async function loadVersionFormConfig(
  shadersVolume: string,
  versionId: string,
): Promise<FormConfig | null> {
  // 1. Try explicit form.json
  const versionPath = getVersionPath(shadersVolume, versionId);
  const formPath = resolve(versionPath, "form.json");
  const formFile = Bun.file(formPath);

  if (await formFile.exists()) {
    try {
      return (await formFile.json()) as FormConfig;
    } catch (err) {
      console.warn(
        `[Versions] Failed to load form.json for version "${versionId}": ${err}`,
      );
    }
  }

  // 2. Fall back to Settings.hlsl parsing
  const parsed = await getOrParseSettings(shadersVolume, versionId);
  return parsed?.formConfig ?? null;
}

/**
 * Load the default settings for a specific version.
 *
 * Resolution order:
 * 1. Explicit `defaults.json` in the version directory
 * 2. Auto-generated from Settings.hlsl inside the version's archive
 * 3. null (caller should fall back to global defaults)
 */
export async function loadVersionDefaults(
  shadersVolume: string,
  versionId: string,
): Promise<RawSettings | null> {
  // 1. Try explicit defaults.json
  const versionPath = getVersionPath(shadersVolume, versionId);
  const defaultsPath = resolve(versionPath, "defaults.json");
  const defaultsFile = Bun.file(defaultsPath);

  if (await defaultsFile.exists()) {
    try {
      return (await defaultsFile.json()) as RawSettings;
    } catch (err) {
      console.warn(
        `[Versions] Failed to load defaults.json for version "${versionId}": ${err}`,
      );
    }
  }

  // 2. Fall back to Settings.hlsl parsing
  const parsed = await getOrParseSettings(shadersVolume, versionId);
  return parsed?.defaults ?? null;
}

/**
 * Check if a version ID is known.
 */
export async function isValidVersion(
  shadersVolume: string,
  versionId: string,
): Promise<boolean> {
  const manifest = await discoverVersions(shadersVolume);
  return manifest.versions.some((v) => v.id === versionId);
}

/**
 * Reset cached version data. Call on server shutdown or reconfiguration.
 */
export function resetVersionCache(): void {
  _cachedManifest = null;
  _archivePathMap.clear();
  _parsedSettingsCache.clear();
}

// ── Internal Helpers ─────────────────────────────────────────────

function parseVersionsJson(
  entries: readonly VersionsJsonEntry[],
): VersionsManifest {
  if (!Array.isArray(entries) || entries.length === 0) {
    return {
      versions: [{ id: DEFAULT_VERSION_ID, label: "BetterRTX", isDefault: true }],
      defaultVersion: DEFAULT_VERSION_ID,
    };
  }

  let defaultId: string | null = null;
  const versions: VersionInfo[] = entries.map((entry) => {
    const isDefault = entry.default === true;
    if (isDefault) defaultId = entry.id;
    return {
      id: entry.id,
      label: entry.label ?? entry.id,
      isDefault,
    };
  });

  // If no explicit default, use the first entry
  if (!defaultId) {
    defaultId = versions[0]!.id;
    versions[0] = { ...versions[0]!, isDefault: true };
  }

  return { versions, defaultVersion: defaultId };
}

/** Known material directory names that should not be treated as versions. */
const MATERIAL_DIR_NAMES: ReadonlySet<string> = new Set(TARGET_MATERIALS);

async function autoDiscoverVersions(
  shadersVolume: string,
): Promise<VersionsManifest> {
  const versions: VersionInfo[] = [];

  try {
    const entries = await readdir(shadersVolume, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      // Skip known non-version directories
      if (entry.name === "vanilla" || entry.name.startsWith(".")) continue;
      // Skip material directories from the flat layout (RTXStub, RTXPostFX.*)
      if (MATERIAL_DIR_NAMES.has(entry.name)) continue;

      const subdir = resolve(shadersVolume, entry.name);
      const hasManifest = await Bun.file(resolve(subdir, "manifest.json")).exists();
      const hasArchive = await Bun.file(resolve(subdir, "shader_source.tar.gz")).exists();

      // Also check for material config.json files (archive mode)
      let hasConfig = false;
      if (!hasManifest && !hasArchive) {
        try {
          const subEntries = await readdir(subdir, { withFileTypes: true });
          for (const e of subEntries) {
            if (!e.isDirectory()) continue;
            if (await Bun.file(resolve(subdir, e.name, "config.json")).exists()) {
              hasConfig = true;
              break;
            }
          }
        } catch {
          // Ignore errors
        }
      }

      if (hasManifest || hasArchive || hasConfig) {
        versions.push({
          id: entry.name,
          label: entry.name,
          isDefault: false,
        });
      }
    }
  } catch {
    // readdir failed — volume may not exist yet
  }

  if (versions.length === 0) {
    return { versions: [], defaultVersion: DEFAULT_VERSION_ID };
  }

  // Sort by ID, mark latest as default
  versions.sort((a, b) => a.id.localeCompare(b.id));
  versions[versions.length - 1] = {
    ...versions[versions.length - 1]!,
    isDefault: true,
  };
  const defaultVersion = versions[versions.length - 1]!.id;

  return { versions, defaultVersion };
}

// ── Named Archive Discovery ─────────────────────────────────────

async function discoverVersionsFromArchives(
  shadersVolume: string,
): Promise<VersionsManifest> {
  const versions: VersionInfo[] = [];

  try {
    const entries = await readdir(shadersVolume, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) continue;
      const match = entry.name.match(VERSIONED_ARCHIVE_RE);
      if (!match) continue;

      const versionId = match[1]!;
      _archivePathMap.set(versionId, resolve(shadersVolume, entry.name));
      versions.push({
        id: versionId,
        label: `BetterRTX ${versionId}`,
        isDefault: false,
      });
    }
  } catch {
    // readdir failed
  }

  if (versions.length === 0) {
    return { versions: [], defaultVersion: DEFAULT_VERSION_ID };
  }

  // Sort by version (numeric-aware), mark latest as default
  versions.sort((a, b) =>
    a.id.localeCompare(b.id, undefined, { numeric: true }),
  );
  versions[versions.length - 1] = {
    ...versions[versions.length - 1]!,
    isDefault: true,
  };

  return { versions, defaultVersion: versions[versions.length - 1]!.id };
}

// ── Settings.hlsl Parsing Cache ─────────────────────────────────

const _parsedSettingsCache = new Map<string, ParsedSettingsResult | null>();

async function getOrParseSettings(
  shadersVolume: string,
  versionId: string,
): Promise<ParsedSettingsResult | null> {
  const cached = _parsedSettingsCache.get(versionId);
  if (cached !== undefined) return cached;

  const source = await extractSettingsHlsl(shadersVolume, versionId);
  if (!source) {
    _parsedSettingsCache.set(versionId, null);
    return null;
  }

  try {
    const result = parseSettingsHlsl(source);
    _parsedSettingsCache.set(versionId, result);
    console.log(
      `[Versions] Parsed Settings.hlsl for "${versionId}": ` +
        `${result.formConfig.categories.length} categories, ` +
        `${Object.keys(result.defaults).length} defaults`,
    );
    return result;
  } catch (err) {
    console.warn(
      `[Versions] Failed to parse Settings.hlsl for "${versionId}": ${err}`,
    );
    _parsedSettingsCache.set(versionId, null);
    return null;
  }
}

/**
 * Extract the Settings.hlsl text from a version's shader data.
 *
 * Tries (in order):
 * 1. Named archive `<prefix>-<id>.tar.gz` — find `RTXStub/shaders/Settings.hlsl`
 * 2. Directory `<shadersVolume>/<id>/RTXStub/shaders/Settings.hlsl`
 * 3. Root `<shadersVolume>/RTXStub/shaders/Settings.hlsl` (flat layout)
 */
async function extractSettingsHlsl(
  shadersVolume: string,
  versionId: string,
): Promise<string | null> {
  // 1. Named archive
  const archivePath = await getVersionArchivePath(shadersVolume, versionId);

  if (archivePath) {
    try {
      const bytes = await Bun.file(archivePath).bytes();
      const archive = new Bun.Archive(bytes);
      const entries = await archive.files();
      const decoder = new TextDecoder("utf-8");

      for (const [path, blob] of entries) {
        if (path.endsWith("/RTXStub/shaders/Settings.hlsl")) {
          return decoder.decode(new Uint8Array(await blob.arrayBuffer()));
        }
      }
    } catch (err) {
      console.warn(
        `[Versions] Failed to extract Settings.hlsl from archive for "${versionId}": ${err}`,
      );
    }
  }

  // 2. Version subdirectory
  const versionPath = getVersionPath(shadersVolume, versionId);
  const directPath = resolve(versionPath, "RTXStub", "shaders", "Settings.hlsl");
  const directFile = Bun.file(directPath);

  if (await directFile.exists()) {
    try {
      return await directFile.text();
    } catch {
      // Fall through
    }
  }

  // 3. Root (flat layout)
  if (versionId === DEFAULT_VERSION_ID) {
    const rootPath = resolve(shadersVolume, "RTXStub", "shaders", "Settings.hlsl");
    const rootFile = Bun.file(rootPath);
    if (await rootFile.exists()) {
      try {
        return await rootFile.text();
      } catch {
        // Fall through
      }
    }
  }

  return null;
}
