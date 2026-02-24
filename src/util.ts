import { ShaderPlatform, SHADER_PLATFORM_NAMES } from "./material/enums.ts";

export function formatDefinitionName(name: string): string {
  // aA -> a_A
  let result = name.replace(/([a-z]+)([A-Z])/g, "$1_$2");
  // AAa -> A_Aa
  result = result.replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2");
  // 00X -> 00_X
  result = result.replace(/(\d+)([a-zA-Z])/g, "$1_$2");
  return result.toUpperCase();
}

export function generateFlagNameMacro(key: string, value: string, isBool = false): string {
  if (isBool) return formatDefinitionName(key);
  return formatDefinitionName(key + "__" + value);
}

export function generatePassNameMacro(name: string): string {
  const formatted = formatDefinitionName(name);
  if (formatted.endsWith("_PASS")) return formatted;
  return formatted + "_PASS";
}

export function insertHeaderComment(code: string, comment: string): string {
  if (code.startsWith("#version")) {
    return code.replace("\n", "\n\n" + comment + "\n\n");
  }
  return comment + "\n\n" + code;
}

export function insertVersionDirective(code: string, platform: ShaderPlatform): string {
  if (/^\s*#\s*version\s+/m.test(code)) return code;

  const platformName = SHADER_PLATFORM_NAMES[platform];
  const versionString = platformName.slice(-3);
  const suffix =
    platform === ShaderPlatform.ESSL_300 || platform === ShaderPlatform.ESSL_310
      ? " es"
      : "";

  return `#version ${versionString}${suffix}\n${code}`;
}
