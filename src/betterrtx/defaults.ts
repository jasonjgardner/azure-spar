/**
 * Default BetterRTX shader settings.
 *
 * These 168 parameters control ray tracing, lighting, atmosphere,
 * post-processing, and visual effects. User settings are merged
 * over these defaults before compilation.
 */

import type { RawSettings } from "./settings.ts";

import defaultSettings from "./defaults.json" with { type: "json" };

/** The default BetterRTX shader settings (168 parameters). */
export const DEFAULT_SETTINGS: RawSettings = defaultSettings;

/** List of all known default setting keys. */
export const DEFAULT_SETTING_KEYS: readonly string[] = Object.keys(
  defaultSettings,
);
