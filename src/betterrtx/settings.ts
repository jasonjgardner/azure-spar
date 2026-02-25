/**
 * User customization settings for BetterRTX shader compilation.
 *
 * Settings are JSON key-value pairs that become DXC `-D` preprocessor defines.
 * values need to be specified — everything else uses the HLSL defaults.
 *
 * Value conversion:
 *   boolean  → true="(1)", false="(0)"
 *   number   → "(7)" or "(0.23)"
 *   string   → "(float4(1.0, 0.8, 0.6, 7.5))" (HLSL expressions)
 */

// ── Types ────────────────────────────────────────────────────────

/** A single setting value as parsed from user JSON. */
export type SettingValue = boolean | number | string;

/** Raw user settings as parsed from JSON. */
export type RawSettings = Readonly<Record<string, SettingValue>>;

/** DXC-ready defines (key → parenthesized string value). */
export type SettingsDefines = Readonly<Record<string, string>>;

// ── Errors ───────────────────────────────────────────────────────

export class SettingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SettingsError";
  }
}

// ── Parsing ──────────────────────────────────────────────────────

/**
 * Parse a JSON string into validated settings.
 * Throws SettingsError if JSON is invalid or not a flat object.
 */
export function parseSettingsJson(json: string): RawSettings {
  let parsed: unknown;

  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new SettingsError(`Invalid JSON: ${err}`);
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new SettingsError("Settings must be a JSON object");
  }

  // Validate each value is a supported type
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (key.startsWith("$")) continue; // Metadata keys are stripped later

    const type = typeof value;
    if (type !== "boolean" && type !== "number" && type !== "string") {
      throw new SettingsError(
        `Setting "${key}" has unsupported type "${type}". Expected boolean, number, or string.`,
      );
    }
  }

  return parsed as RawSettings;
}

// ── Conversion ───────────────────────────────────────────────────

/**
 * Convert a single setting value to a parenthesized DXC define string.
 *
 * Wrapping in parentheses ensures HLSL macro safety for expressions
 * like `MACRO * 2` where operator precedence could be an issue.
 */
export function convertSettingValue(value: SettingValue): string {
  if (typeof value === "boolean") {
    return value ? "(1)" : "(0)";
  }

  if (typeof value === "number") {
    return `(${value})`;
  }

  return `(${value})`;
}

/**
 * Convert user settings to DXC `-D` defines.
 *
 * Strips keys starting with `$` (metadata like `$upload`, `$comment`).
 * Each value is wrapped in parentheses for HLSL macro safety.
 */
export function settingsToDefines(settings: RawSettings): SettingsDefines {
  const defines: Record<string, string> = {};

  for (const [key, value] of Object.entries(settings)) {
    if (key.startsWith("$")) continue;
    defines[key] = convertSettingValue(value);
  }

  return defines;
}

// ── File Loading ─────────────────────────────────────────────────

/**
 * Load settings from a JSON file on disk.
 * Returns an empty object if the file does not exist.
 */
export async function loadSettingsFile(path: string): Promise<RawSettings> {
  const file = Bun.file(path);

  if (!(await file.exists())) {
    throw new SettingsError(`Settings file not found: ${path}`);
  }

  const text = await file.text();
  return parseSettingsJson(text);
}
