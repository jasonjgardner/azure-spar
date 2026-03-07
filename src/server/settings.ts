/**
 * Settings merging and hashing for the build server.
 *
 * User settings are merged over defaults, hashed for caching,
 * and converted to DXC defines — all without touching disk.
 */

import {
  parseSettingsJson,
  settingsToDefines,
  type RawSettings,
  type SettingsDefines,
} from "../betterrtx/settings.ts";
import { DEFAULT_VERSION_ID } from "./types.ts";

/**
 * Merge user-provided settings over defaults.
 * Returns a new immutable settings object.
 */
export function mergeSettings(
  defaults: RawSettings,
  userSettings: RawSettings,
): RawSettings {
  return { ...defaults, ...userSettings };
}

/**
 * Compute a deterministic SHA-256 hash of settings for caching.
 *
 * Strips $-prefixed metadata keys and sorts remaining keys
 * alphabetically to ensure identical settings always produce
 * the same hash regardless of key order.
 *
 * When a version is provided, it's included in the hash input
 * so that identical settings for different versions produce
 * different hashes (preventing cross-version deduplication).
 */
export function hashSettings(
  settings: RawSettings,
  version: string = DEFAULT_VERSION_ID,
): string {
  const filtered = Object.entries(settings)
    .filter(([key]) => !key.startsWith("$"))
    .sort(([a], [b]) => a.localeCompare(b));

  const canonical = JSON.stringify(Object.fromEntries(filtered));
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(`v:${version}:`);
  hasher.update(canonical);
  return hasher.digest("hex");
}

/**
 * Parse, merge, and convert settings to DXC defines in one step.
 *
 * @param rawJson - Raw JSON string from the request body
 * @param defaults - Default settings to merge under user settings
 * @param version - Optional version ID included in the hash
 * @returns Merged settings, DXC defines, and cache hash
 */
export function processSettings(
  rawJson: string,
  defaults: RawSettings,
  version?: string,
): {
  readonly settings: RawSettings;
  readonly defines: SettingsDefines;
  readonly hash: string;
} {
  const parsed = parseSettingsJson(rawJson);
  const settings = mergeSettings(defaults, parsed);
  const defines = settingsToDefines(settings);
  const hash = hashSettings(settings, version);
  return { settings, defines, hash };
}
