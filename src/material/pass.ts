import type { BinaryReader } from "../binary/reader.ts";
import type { BinaryWriter } from "../binary/writer.ts";
import type { ShaderFlags, FlagDefinition } from "../types.ts";
import {
  ShaderPlatform,
  ShaderStage,
  BlendMode,
  BLEND_MODE_NAMES,
} from "./enums.ts";
import {
  type SupportedPlatforms,
  parseSupportedPlatforms,
  getSupportedPlatformsBitString,
  serializeSupportedPlatforms,
  loadSupportedPlatformsFromJson,
  createSupportedPlatforms,
} from "./supported-platforms.ts";
import {
  type Variant,
  readVariant,
  writeVariant,
  serializeVariantProperties,
  serializeVariantMinimal,
  loadVariantMinimal,
  loadVariantFromJson,
  labelVariant,
  getVariantPlatforms,
  getVariantStages,
  mergeVariant,
  addPlatformsToVariant,
  removePlatformsFromVariant,
} from "./variant.ts";
import type { ShaderInput } from "./shader-input.ts";

export interface Pass {
  readonly name: string;
  readonly supportedPlatforms: SupportedPlatforms;
  readonly fallbackPass: string;
  readonly defaultBlendMode: BlendMode;
  readonly defaultVariant: ShaderFlags;
  readonly framebufferBinding: number;
  readonly variants: readonly Variant[];
}

export function readPass(reader: BinaryReader, version: number): Pass {
  const name = reader.readString();
  const supportedPlatforms = parseSupportedPlatforms(reader.readString(), version);
  const fallbackPass = reader.readString();

  const defaultBlendMode = reader.readBool()
    ? (reader.readUshort() as BlendMode)
    : BlendMode.Unspecified;

  const defaultFlagCount = reader.readUshort();
  const defaultVariant: Record<string, string> = {};
  for (let i = 0; i < defaultFlagCount; i++) {
    const key = reader.readString();
    defaultVariant[key] = reader.readString();
  }

  const framebufferBinding = version >= 23 ? reader.readUlong() : 0;

  const variantCount = reader.readUshort();
  const variants: Variant[] = [];
  for (let i = 0; i < variantCount; i++) {
    variants.push(readVariant(reader, version));
  }

  return {
    name,
    supportedPlatforms,
    fallbackPass,
    defaultBlendMode,
    defaultVariant,
    framebufferBinding,
    variants,
  };
}

export function writePass(writer: BinaryWriter, pass: Pass, version: number): void {
  writer.writeString(pass.name);
  writer.writeString(getSupportedPlatformsBitString(pass.supportedPlatforms, version));
  writer.writeString(pass.fallbackPass);

  writer.writeBool(pass.defaultBlendMode !== BlendMode.Unspecified);
  if (pass.defaultBlendMode !== BlendMode.Unspecified) {
    writer.writeUshort(pass.defaultBlendMode);
  }

  const defaultEntries = Object.entries(pass.defaultVariant);
  writer.writeUshort(defaultEntries.length);
  for (const [key, value] of defaultEntries) {
    writer.writeString(key);
    writer.writeString(value);
  }

  if (version >= 23) {
    writer.writeUlong(pass.framebufferBinding);
  }

  writer.writeUshort(pass.variants.length);
  for (const variant of pass.variants) {
    writeVariant(writer, variant, version);
  }
}

export function serializePassProperties(
  pass: Pass,
  version: number,
): Record<string, unknown> {
  return {
    name: pass.name,
    supported_platforms: serializeSupportedPlatforms(pass.supportedPlatforms, version),
    fallback_pass: pass.fallbackPass,
    default_blend_mode:
      pass.defaultBlendMode !== BlendMode.Unspecified
        ? BLEND_MODE_NAMES[pass.defaultBlendMode]
        : "",
    default_variant: { ...pass.defaultVariant },
    framebuffer_binding: pass.framebufferBinding,
    variants: pass.variants.map((v, i) => serializeVariantProperties(v, i)),
  };
}

export function serializePassMinimal(
  pass: Pass,
  flagDefinitions: Record<string, string[]>,
  inputDefinitions: readonly ShaderInput[],
  version: number,
): unknown[] {
  const flagKeys = Object.keys(flagDefinitions);
  const defaultVariantIndexed: Record<number, number> = {};
  for (const [key, value] of Object.entries(pass.defaultVariant)) {
    const keyIdx = flagKeys.indexOf(key);
    const valIdx = flagDefinitions[key]!.indexOf(value);
    defaultVariantIndexed[keyIdx] = valIdx;
  }

  const arr: unknown[] = [
    pass.name,
    getSupportedPlatformsBitString(pass.supportedPlatforms, version),
    pass.fallbackPass,
    pass.defaultBlendMode !== BlendMode.Unspecified ? pass.defaultBlendMode : "",
    defaultVariantIndexed,
    pass.framebufferBinding,
    pass.variants.map((v) => serializeVariantMinimal(v, flagDefinitions, inputDefinitions)),
  ];

  return arr;
}

export function loadPassMinimal(
  arr: unknown[],
  flagDefinitions: Record<string, string[]>,
  inputDefinitions: readonly ShaderInput[],
  version: number,
): Pass {
  const name = arr[0] as string;
  const supportedPlatforms = parseSupportedPlatforms(arr[1] as string, version);
  const fallbackPass = arr[2] as string;

  const modeVal = arr[3];
  const defaultBlendMode =
    typeof modeVal === "number" ? (modeVal as BlendMode) : BlendMode.Unspecified;

  const flagKeys = Object.keys(flagDefinitions);
  const indexedFlags = arr[4] as Record<string, number>;
  const defaultVariant: Record<string, string> = {};
  for (const [keyIdx, valIdx] of Object.entries(indexedFlags)) {
    const key = flagKeys[parseInt(keyIdx, 10)]!;
    defaultVariant[key] = flagDefinitions[key]![valIdx]!;
  }

  const framebufferBinding = arr[5] as number;
  const variants = (arr[6] as unknown[][]).map((v) =>
    loadVariantMinimal(v, flagDefinitions, inputDefinitions)
  );

  return {
    name,
    supportedPlatforms,
    fallbackPass,
    defaultBlendMode,
    defaultVariant,
    framebufferBinding,
    variants,
  };
}

export function loadPassFromJson(
  obj: Record<string, unknown>,
  passPath: string,
  loadShaderFile: (path: string) => Uint8Array,
): Pass {
  const name = (obj["name"] as string) ?? "";
  const supportedPlatforms = obj["supported_platforms"]
    ? loadSupportedPlatformsFromJson(obj["supported_platforms"] as Record<string, boolean>)
    : createSupportedPlatforms();
  const fallbackPass = (obj["fallback_pass"] as string) ?? "";

  const modeStr = obj["default_blend_mode"] as string | undefined;
  const defaultBlendMode = modeStr
    ? (Object.entries(BLEND_MODE_NAMES).find(([, v]) => v === modeStr)?.[0] as unknown as BlendMode) ?? BlendMode.Unspecified
    : BlendMode.Unspecified;

  const defaultVariant = (obj["default_variant"] as Record<string, string>) ?? {};
  const framebufferBinding = (obj["framebuffer_binding"] as number) ?? 0;

  const variantObjs = (obj["variants"] as Record<string, unknown>[]) ?? [];
  const variants = variantObjs.map((v) => loadVariantFromJson(v, passPath, loadShaderFile));

  return {
    name,
    supportedPlatforms,
    fallbackPass,
    defaultBlendMode,
    defaultVariant,
    framebufferBinding,
    variants,
  };
}

export function labelPass(pass: Pass, materialName: string): Pass {
  return {
    ...pass,
    variants: pass.variants.map((v, i) => labelVariant(v, materialName, pass.name, i)),
  };
}

export function sortPassVariants(pass: Pass): Pass {
  const sortedDefault = Object.fromEntries(
    Object.entries(pass.defaultVariant).sort(([a], [b]) => a.localeCompare(b))
  );

  const sortedVariants = pass.variants
    .map((v) => ({
      ...v,
      flags: Object.fromEntries(
        Object.entries(v.flags).sort(([a], [b]) => a.localeCompare(b))
      ),
    }))
    .sort((a, b) => JSON.stringify(a.flags).localeCompare(JSON.stringify(b.flags)));

  return { ...pass, defaultVariant: sortedDefault, variants: sortedVariants };
}

export function getPassPlatforms(pass: Pass): Set<ShaderPlatform> {
  const platforms = new Set<ShaderPlatform>();
  for (const variant of pass.variants) {
    for (const p of getVariantPlatforms(variant)) {
      platforms.add(p);
    }
  }
  return platforms;
}

export function getPassStages(pass: Pass): Set<ShaderStage> {
  const stages = new Set<ShaderStage>();
  for (const variant of pass.variants) {
    for (const s of getVariantStages(variant)) {
      stages.add(s);
    }
  }
  return stages;
}

export function getPassFlagDefinitions(pass: Pass): Record<string, Set<string>> {
  const definitions: Record<string, Set<string>> = {};
  for (const [key, value] of Object.entries(pass.defaultVariant)) {
    if (!definitions[key]) definitions[key] = new Set();
    definitions[key]!.add(value);
  }
  for (const variant of pass.variants) {
    for (const [key, value] of Object.entries(variant.flags)) {
      if (!definitions[key]) definitions[key] = new Set();
      definitions[key]!.add(value);
    }
  }
  return definitions;
}
