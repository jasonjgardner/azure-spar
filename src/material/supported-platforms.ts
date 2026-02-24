import {
  ShaderPlatform,
  SHADER_PLATFORM_NAMES,
  shaderPlatformFromName,
  getPlatformList,
} from "./enums.ts";

export interface SupportedPlatforms {
  readonly platforms: ReadonlyMap<ShaderPlatform, boolean>;
}

function validateBitString(bitString: string, length: number): string {
  if ([...bitString].some((c) => c !== "0" && c !== "1")) {
    return "1".repeat(length);
  }
  return bitString;
}

function formatBitString(bitString: string, length: number): string {
  // Truncate if too long
  let result = bitString.slice(0, length);
  // Pad with leading zeros if too short
  result = result.padStart(length, "0");
  return result;
}

export function createSupportedPlatforms(): SupportedPlatforms {
  const platforms = new Map<ShaderPlatform, boolean>();
  for (const p of Object.values(ShaderPlatform)) {
    if (typeof p === "number") {
      platforms.set(p, true);
    }
  }
  return { platforms };
}

export function parseSupportedPlatforms(bitString: string, version: number): SupportedPlatforms {
  const platformList = getPlatformList(version);
  const length = platformList.length;

  const validated = validateBitString(bitString, length);
  const formatted = formatBitString(validated, length);

  const platforms = new Map<ShaderPlatform, boolean>();

  // Initialize all platforms as true (default)
  for (const p of Object.values(ShaderPlatform)) {
    if (typeof p === "number") {
      platforms.set(p, true);
    }
  }

  // Override with bit string values
  for (let i = 0; i < platformList.length; i++) {
    platforms.set(platformList[i]!, formatted[i] === "1");
  }

  return { platforms };
}

export function getSupportedPlatformsBitString(sp: SupportedPlatforms, version: number): string {
  return getPlatformList(version)
    .map((p) => (sp.platforms.get(p) ? "1" : "0"))
    .join("");
}

export function serializeSupportedPlatforms(
  sp: SupportedPlatforms,
  version: number,
): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  for (const p of getPlatformList(version)) {
    result[SHADER_PLATFORM_NAMES[p]] = sp.platforms.get(p) ?? true;
  }
  return result;
}

export function loadSupportedPlatformsFromJson(
  data: Record<string, boolean>,
): SupportedPlatforms {
  const platforms = new Map<ShaderPlatform, boolean>();

  // Initialize all as true
  for (const p of Object.values(ShaderPlatform)) {
    if (typeof p === "number") {
      platforms.set(p, true);
    }
  }

  // Override with JSON data
  for (const [key, value] of Object.entries(data)) {
    platforms.set(shaderPlatformFromName(key), value);
  }

  return { platforms };
}
