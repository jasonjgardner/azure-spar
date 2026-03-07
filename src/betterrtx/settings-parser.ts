/**
 * Settings.hlsl parser for auto-generating form configurations.
 *
 * Reads a BetterRTX Settings.hlsl file and produces a FormConfig
 * (for the creator UI) and RawSettings defaults (macro → value map).
 *
 * The parser handles:
 * - Category headers (`/* === Category Name === *​/`)
 * - Toggle fields (bare 0/1 without enum comments)
 * - Select fields (integer with numbered enum comments)
 * - Slider fields (float values)
 * - Color fields (float3/float4 HLSL constructors)
 *
 * It skips derived constants, complex expressions (PI, sqrt),
 * and the "Should Not Be Touched" section.
 */

import type {
  FormConfig,
  FormCategory,
  FormField,
  ToggleField,
  SliderField,
  SelectField,
  ColorField,
} from "../server/form-types.ts";
import type { RawSettings, SettingValue } from "./settings.ts";

// ── Public API ──────────────────────────────────────────────────

export interface ParsedSettingsResult {
  readonly formConfig: FormConfig;
  readonly defaults: RawSettings;
}

/**
 * Parse a Settings.hlsl source string into a form configuration
 * and default settings map.
 */
export function parseSettingsHlsl(source: string): ParsedSettingsResult {
  const settings = extractSettings(source);
  const fields: Array<{ readonly setting: ParsedSetting; readonly field: FormField }> = [];

  for (const setting of settings) {
    const field = inferField(setting);
    if (!field) continue;
    fields.push({ setting, field });
  }

  // Group fields by category
  const categoryMap = new Map<string, { label: string; fields: FormField[] }>();
  for (const { setting, field } of fields) {
    const existing = categoryMap.get(setting.categoryId);
    if (existing) {
      existing.fields.push(field);
    } else {
      categoryMap.set(setting.categoryId, {
        label: setting.categoryLabel,
        fields: [field],
      });
    }
  }

  const categories: FormCategory[] = [...categoryMap.entries()].map(
    ([id, { label, fields: catFields }]) => ({
      id,
      label,
      icon: categoryIcon(id),
      fields: catFields,
    }),
  );

  const defaults = buildDefaults(settings);

  return { formConfig: { categories }, defaults };
}

// ── Internal Types ──────────────────────────────────────────────

interface ParsedSetting {
  readonly macro: string;
  readonly rawValue: string;
  readonly comments: readonly string[];
  readonly categoryId: string;
  readonly categoryLabel: string;
}

interface EnumOption {
  readonly value: number;
  readonly label: string;
}

type ParsedValue =
  | { readonly type: "integer"; readonly value: number }
  | { readonly type: "float"; readonly value: number }
  | { readonly type: "float3"; readonly components: readonly [number, number, number] }
  | { readonly type: "float4"; readonly components: readonly [number, number, number, number] }
  | { readonly type: "unknown"; readonly raw: string };

// ── Category Extraction ─────────────────────────────────────────

function extractCategoryBoundaries(
  source: string,
): readonly { readonly name: string; readonly offset: number }[] {
  // Regex created locally to avoid stateful /g lastIndex across calls
  const categoryRe = /\/\*\s*=+\s*\n\s+(.+?)\s*\n\s*=+\s*\*\//g;
  const boundaries: { name: string; offset: number }[] = [];
  let match: RegExpExecArray | null;

  while ((match = categoryRe.exec(source)) !== null) {
    boundaries.push({ name: match[1]!.trim(), offset: match.index });
  }

  return boundaries;
}

function categoryForOffset(
  offset: number,
  boundaries: readonly { readonly name: string; readonly offset: number }[],
): string {
  let current = "Uncategorized";
  for (const b of boundaries) {
    if (b.offset > offset) break;
    current = b.name;
  }
  return current;
}

// ── Settings Extraction (line-by-line) ──────────────────────────

const STOP_PHRASE = "Should Not Be Touched";

function extractSettings(source: string): readonly ParsedSetting[] {
  const lines = source.split("\n");
  const boundaries = extractCategoryBoundaries(source);
  const settings: ParsedSetting[] = [];

  let commentBuffer: string[] = [];
  let charOffset = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const trimmed = line.trim();

    // Check for stop section
    const currentCategory = categoryForOffset(charOffset, boundaries);
    if (currentCategory.includes(STOP_PHRASE)) break;

    // Accumulate single-line comments
    if (trimmed.startsWith("//")) {
      commentBuffer.push(trimmed.slice(2).trim());
      charOffset += line.length + 1;
      continue;
    }

    // Match #ifndef MACRO_NAME
    const ifndefMatch = trimmed.match(/^#ifndef\s+(\w+)$/);
    if (ifndefMatch) {
      const macro = ifndefMatch[1]!;

      // Skip include guards like __SETTINGS_HLSL__
      if (macro.startsWith("__")) {
        commentBuffer = [];
        charOffset += line.length + 1;
        continue;
      }

      // Read the next line for #define
      const nextLine = (lines[i + 1] ?? "").trim();
      const defineMatch = nextLine.match(
        /^#define\s+\w+\s+(.*?)(?:\s*\/\/\s*(.*))?$/,
      );

      if (defineMatch) {
        const rawValue = defineMatch[1]!.trim();

        const catLabel = categoryForOffset(charOffset, boundaries);
        settings.push({
          macro,
          rawValue,
          comments: [...commentBuffer],
          categoryId: categoryToId(catLabel),
          categoryLabel: catLabel,
        });
      }

      commentBuffer = [];
      // Skip past #ifndef, #define, #endif
      charOffset += line.length + 1;
      if (i + 1 < lines.length) charOffset += lines[i + 1]!.length + 1;
      if (i + 2 < lines.length) charOffset += lines[i + 2]!.length + 1;
      i += 2;
      continue;
    }

    // Block comment or empty line — don't clear comment buffer for block comments
    if (trimmed.startsWith("/*") || trimmed.startsWith("*") || trimmed === "") {
      charOffset += line.length + 1;
      continue;
    }

    // Other line — reset comment buffer
    commentBuffer = [];
    charOffset += line.length + 1;
  }

  return settings;
}

// ── Value Parsing ───────────────────────────────────────────────

/** Strip wrapping parentheses only if they are a matched outer pair. */
function stripOuterParens(s: string): string {
  if (!s.startsWith("(") || !s.endsWith(")")) return s;

  let depth = 0;
  for (let i = 0; i < s.length - 1; i++) {
    if (s[i] === "(") depth++;
    if (s[i] === ")") depth--;
    if (depth === 0) return s; // Opener closed before end — not a wrapper
  }
  return s.slice(1, -1).trim();
}

function parseValue(raw: string): ParsedValue {
  let value = raw.trim();

  // Strip outer parentheses only if they form a matched wrapper pair
  value = stripOuterParens(value);

  // float4(r, g, b, a)
  const f4Match = value.match(/^float4\(\s*(.+?)\s*\)$/);
  if (f4Match) {
    const parts = f4Match[1]!.split(",").map((s) => parseFloat(s.trim()));
    if (parts.length === 4 && parts.every((n) => !isNaN(n))) {
      return {
        type: "float4",
        components: parts as unknown as [number, number, number, number],
      };
    }
  }

  // float3(r, g, b)
  const f3Match = value.match(/^float3\(\s*(.+?)\s*\)$/);
  if (f3Match) {
    const parts = f3Match[1]!.split(",").map((s) => parseFloat(s.trim()));
    if (parts.length === 3 && parts.every((n) => !isNaN(n))) {
      return {
        type: "float3",
        components: parts as unknown as [number, number, number],
      };
    }
  }

  // Strip trailing 'f' suffix: 0.4f → 0.4, 128.f → 128.
  if (value.endsWith("f")) value = value.slice(0, -1);

  const num = parseFloat(value);
  if (!isNaN(num)) {
    const isInt = Number.isInteger(num) && !value.includes(".");
    return isInt
      ? { type: "integer", value: num }
      : { type: "float", value: num };
  }

  return { type: "unknown", raw };
}

function isDerivedOrComplex(raw: string): boolean {
  let value = raw.trim();
  if (value.startsWith("(") && value.endsWith(")")) {
    value = value.slice(1, -1).trim();
  }

  // Allow float3/float4 constructors with literal args
  if (/^float[34]\(.+\)$/.test(value)) {
    // Check that all args are numeric literals (including scientific notation)
    const inner = value.replace(/^float[34]\(\s*/, "").replace(/\s*\)$/, "");
    const args = inner.split(",").map((s) => s.trim());
    if (args.every((a) => !isNaN(parseFloat(a)))) return false;
    return true;
  }

  // Allow simple negative numbers
  if (/^-?\d+(\.\d+)?(e[+-]?\d+)?f?$/i.test(value)) return false;

  // References to known math constants or functions
  if (/\b(PI|sqrt|sin|cos|pow|abs|min|max)\b/i.test(value)) return true;

  // Contains uppercase identifiers (macro references)
  const identifiers = value.match(/[A-Z_][A-Z0-9_]{2,}/g) ?? [];
  if (identifiers.length > 0) return true;

  // Contains division/multiplication with non-numeric operands
  if (/[/*+]\s*[a-zA-Z_]/.test(value)) return true;
  if (/[a-zA-Z_]\s*[/*+]/.test(value)) return true;

  return false;
}

// ── Enum Extraction ─────────────────────────────────────────────

function extractEnumOptions(comments: readonly string[]): readonly EnumOption[] {
  const options: EnumOption[] = [];
  for (const comment of comments) {
    const match = comment.match(/^(\d+)\s*:\s*(.+)$/);
    if (match) {
      options.push({
        value: parseInt(match[1]!, 10),
        label: match[2]!.trim(),
      });
    }
  }
  return options;
}

// ── Field Inference ─────────────────────────────────────────────

function inferField(setting: ParsedSetting): FormField | null {
  if (isDerivedOrComplex(setting.rawValue)) return null;

  const parsed = parseValue(setting.rawValue);
  if (parsed.type === "unknown") return null;

  const enumOptions = extractEnumOptions(setting.comments);
  const name = macroToName(setting.macro);
  const label = macroToLabel(setting.macro);
  const description = extractDescription(setting.comments);

  if (parsed.type === "float4") {
    return createColorField(
      name,
      label,
      description,
      setting.macro,
      [parsed.components[0], parsed.components[1], parsed.components[2]],
    );
  }

  if (parsed.type === "float3") {
    return createColorField(
      name,
      label,
      description,
      setting.macro,
      [parsed.components[0], parsed.components[1], parsed.components[2]],
    );
  }

  if (enumOptions.length > 0) {
    return createSelectField(name, label, description, setting.macro, enumOptions, parsed);
  }

  if (parsed.type === "float") {
    return createSliderField(name, label, description, setting.macro, parsed.value);
  }

  if (parsed.type === "integer") {
    // Bare 0 or 1 → toggle
    if (parsed.value === 0 || parsed.value === 1) {
      return createToggleField(name, label, description, setting.macro, parsed.value === 1);
    }
    // Other integers → slider
    return createSliderField(name, label, description, setting.macro, parsed.value);
  }

  return null;
}

// ── Field Factories ─────────────────────────────────────────────

function createToggleField(
  name: string,
  label: string,
  description: string | undefined,
  macro: string,
  defaultValue: boolean,
): ToggleField {
  return {
    type: "toggle",
    name,
    label,
    ...(description ? { description } : {}),
    default: defaultValue,
    macro,
  };
}

function createSliderField(
  name: string,
  label: string,
  description: string | undefined,
  macro: string,
  defaultValue: number,
): SliderField {
  const range = inferSliderRange(defaultValue);
  return {
    type: "slider",
    name,
    label,
    ...(description ? { description } : {}),
    min: range.min,
    max: range.max,
    step: range.step,
    default: defaultValue,
    macro,
  };
}

function createSelectField(
  name: string,
  label: string,
  description: string | undefined,
  macro: string,
  enumOptions: readonly EnumOption[],
  parsed: ParsedValue,
): SelectField {
  const options = enumOptions.map((o) => o.label);
  const macroMap: Record<string, number> = {};
  for (const opt of enumOptions) {
    macroMap[opt.label] = opt.value;
  }

  // Find the default label from the numeric value
  const defaultNum =
    parsed.type === "integer" || parsed.type === "float" ? parsed.value : 0;
  const defaultOption = enumOptions.find((o) => o.value === defaultNum);
  const defaultLabel = defaultOption?.label ?? options[0] ?? "";

  return {
    type: "select",
    name,
    label,
    ...(description ? { description } : {}),
    options,
    default: defaultLabel,
    macro,
    macroMap,
  };
}

function createColorField(
  name: string,
  label: string,
  description: string | undefined,
  macro: string,
  components: readonly [number, number, number],
): ColorField {
  // Determine reasonable step/range from component magnitudes
  const maxComponent = Math.max(...components.map(Math.abs));
  const range = maxComponent <= 1 ? { min: 0, max: 1, step: 0.001 }
    : maxComponent <= 10 ? { min: 0, max: 10, step: 0.01 }
    : { min: 0, max: Math.ceil(maxComponent * 2), step: 0.1 };

  return {
    type: "color",
    name,
    label,
    ...(description ? { description } : {}),
    default: [components[0], components[1], components[2]],
    macro,
    min: range.min,
    max: range.max,
    step: range.step,
  };
}

// ── Slider Range Heuristics ─────────────────────────────────────

function inferSliderRange(
  value: number,
): { readonly min: number; readonly max: number; readonly step: number } {
  if (value === 0) return { min: 0, max: 10, step: 0.1 };

  const absVal = Math.abs(value);

  // Very small values (e.g., 0.0015, 5.5e-6)
  if (absVal < 0.01) {
    const magnitude = Math.pow(10, Math.floor(Math.log10(absVal)));
    return { min: 0, max: round(absVal * 20, 6), step: magnitude };
  }

  // Small decimals (0.01–1.0)
  if (absVal <= 1) {
    return {
      min: value < 0 ? round(value * 2, 4) : 0,
      max: Math.max(1, round(absVal * 4, 2)),
      step: 0.01,
    };
  }

  // Medium values (1–100)
  if (absVal <= 100) {
    return {
      min: value < 0 ? Math.floor(value * 2) : 0,
      max: Math.ceil(absVal * 3),
      step: absVal >= 10 ? 1 : 0.1,
    };
  }

  // Large values (100+)
  return {
    min: 0,
    max: Math.ceil(absVal * 2),
    step: Math.pow(10, Math.floor(Math.log10(absVal)) - 1),
  };
}

function round(n: number, digits: number): number {
  const factor = Math.pow(10, digits);
  return Math.round(n * factor) / factor;
}

// ── Naming ──────────────────────────────────────────────────────

function macroToName(macro: string): string {
  return macro
    .toLowerCase()
    .replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

/** Known abbreviations to preserve as uppercase in labels. */
const ABBREVIATIONS: ReadonlySet<string> = new Set([
  "BRDF", "DOF", "UV", "UVS", "EV", "GI", "MIE", "AGX", "ACES",
  "HDR", "AO", "SSR", "SSAO", "RTX", "DXR",
]);

function macroToLabel(macro: string): string {
  return macro
    .split("_")
    .map((word) => {
      if (ABBREVIATIONS.has(word)) return word;
      return word.charAt(0) + word.slice(1).toLowerCase();
    })
    .join(" ");
}

function extractDescription(comments: readonly string[]): string | undefined {
  const descLines = comments
    .filter((c) => !/^\d+\s*:/.test(c)) // exclude enum lines
    .filter((c) => c.trim().length > 0)
    .filter((c) => !c.startsWith("TODO")); // exclude TODO comments

  if (descLines.length === 0) return undefined;
  return descLines.join(" ");
}

// ── Category Helpers ────────────────────────────────────────────

function categoryToId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const CATEGORY_ICONS: Readonly<Record<string, string>> = {
  lighting: "lightbulb",
  shading: "lightbulb",
  sun: "sun",
  shadow: "sun",
  water: "droplet",
  weather: "cloud-rain",
  atmosphere: "cloud",
  nether: "flame",
  end: "moon",
  dof: "aperture",
  depth: "aperture",
  tone: "contrast",
  post: "wand",
  fix: "wrench",
  status: "heart",
  effect: "heart",
  creator: "palette",
  pixel: "grid",
  deferred: "layers",
  volumetric: "cloud",
};

function categoryIcon(id: string): string {
  for (const [keyword, icon] of Object.entries(CATEGORY_ICONS)) {
    if (id.includes(keyword)) return icon;
  }
  return "settings";
}

// ── Defaults Generation ─────────────────────────────────────────

function buildDefaults(settings: readonly ParsedSetting[]): RawSettings {
  const defaults: Record<string, SettingValue> = {};

  for (const setting of settings) {
    if (isDerivedOrComplex(setting.rawValue)) continue;

    const parsed = parseValue(setting.rawValue);

    switch (parsed.type) {
      case "integer": {
        const hasEnum = extractEnumOptions(setting.comments).length > 0;
        if (hasEnum) {
          defaults[setting.macro] = parsed.value;
        } else if (parsed.value === 0 || parsed.value === 1) {
          defaults[setting.macro] = parsed.value === 1;
        } else {
          defaults[setting.macro] = parsed.value;
        }
        break;
      }
      case "float":
        defaults[setting.macro] = parsed.value;
        break;
      case "float3":
        defaults[setting.macro] = `float3(${parsed.components.join(", ")})`;
        break;
      case "float4":
        defaults[setting.macro] = `float4(${parsed.components.join(", ")})`;
        break;
      case "unknown":
        break;
    }
  }

  return defaults;
}
