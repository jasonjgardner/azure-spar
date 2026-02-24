import type { BinaryReader } from "../binary/reader.ts";
import type { BinaryWriter } from "../binary/writer.ts";
import type { ShaderFlags, FlagDefinition } from "../types.ts";
import { ShaderPlatform, ShaderStage } from "./enums.ts";
import {
  type ShaderDefinition,
  createShaderDefinition,
  readShaderDefinition,
  writeShaderDefinition,
  serializeShaderDefinitionProperties,
  serializeShaderDefinitionMinimal,
  loadShaderDefinitionMinimal,
  loadShaderDefinitionFromJson,
  labelShaderDefinition,
} from "./shader-definition.ts";
import type { ShaderInput } from "./shader-input.ts";
import { createBgfxShader } from "./bgfx-shader.ts";

export interface Variant {
  readonly isSupported: boolean;
  readonly flags: ShaderFlags;
  readonly shaders: readonly ShaderDefinition[];
}

export function readVariant(reader: BinaryReader, version: number): Variant {
  const isSupported = reader.readBool();
  const flagCount = reader.readUshort();
  const shaderCount = reader.readUshort();

  const flags: Record<string, string> = {};
  for (let i = 0; i < flagCount; i++) {
    const key = reader.readString();
    flags[key] = reader.readString();
  }

  const shaders: ShaderDefinition[] = [];
  for (let i = 0; i < shaderCount; i++) {
    shaders.push(readShaderDefinition(reader, version));
  }

  return { isSupported, flags, shaders };
}

export function writeVariant(writer: BinaryWriter, variant: Variant, version: number): void {
  writer.writeBool(variant.isSupported);
  const flagEntries = Object.entries(variant.flags);
  writer.writeUshort(flagEntries.length);
  writer.writeUshort(variant.shaders.length);

  for (const [key, value] of flagEntries) {
    writer.writeString(key);
    writer.writeString(value);
  }

  for (const shader of variant.shaders) {
    writeShaderDefinition(writer, shader, version);
  }
}

export function serializeVariantProperties(
  variant: Variant,
  index: number,
): Record<string, unknown> {
  return {
    is_supported: variant.isSupported,
    flags: { ...variant.flags },
    shaders: variant.shaders.map((s) => serializeShaderDefinitionProperties(s, index)),
  };
}

export function serializeVariantMinimal(
  variant: Variant,
  flagDefinitions: Record<string, string[]>,
  inputDefinitions: readonly ShaderInput[],
): unknown[] {
  const flagKeys = Object.keys(flagDefinitions);
  const indexedFlags: Record<number, number> = {};
  for (const [key, value] of Object.entries(variant.flags)) {
    const keyIdx = flagKeys.indexOf(key);
    const valIdx = flagDefinitions[key]!.indexOf(value);
    indexedFlags[keyIdx] = valIdx;
  }

  return [
    variant.isSupported ? 1 : 0,
    indexedFlags,
    variant.shaders.map((s) => serializeShaderDefinitionMinimal(s, inputDefinitions)),
  ];
}

export function loadVariantMinimal(
  arr: unknown[],
  flagDefinitions: Record<string, string[]>,
  inputDefinitions: readonly ShaderInput[],
): Variant {
  const isSupported = Boolean(arr[0]);
  const flagKeys = Object.keys(flagDefinitions);
  const indexedFlags = arr[1] as Record<string, number>;

  const flags: Record<string, string> = {};
  for (const [keyIdx, valIdx] of Object.entries(indexedFlags)) {
    const key = flagKeys[parseInt(keyIdx, 10)]!;
    flags[key] = flagDefinitions[key]![valIdx]!;
  }

  const shaders = (arr[2] as unknown[][]).map((s) =>
    loadShaderDefinitionMinimal(s, inputDefinitions)
  );

  return { isSupported, flags, shaders };
}

export function loadVariantFromJson(
  obj: Record<string, unknown>,
  passPath: string,
  loadShaderFile: (path: string) => Uint8Array,
): Variant {
  const isSupported = (obj["is_supported"] as boolean) ?? false;
  const flags = (obj["flags"] as Record<string, string>) ?? {};
  const shaderObjs = (obj["shaders"] as Record<string, unknown>[]) ?? [];

  const shaders = shaderObjs.map((sObj) => {
    const fileName = sObj["file_name"] as string;
    const shaderBytes = loadShaderFile(`${passPath}/${fileName}`);
    return loadShaderDefinitionFromJson(sObj, shaderBytes);
  });

  return { isSupported, flags, shaders };
}

export function labelVariant(
  variant: Variant,
  materialName: string,
  passName: string,
  variantIndex: number,
): Variant {
  return {
    ...variant,
    shaders: variant.shaders.map((shader) =>
      labelShaderDefinition(
        shader,
        materialName,
        passName,
        variantIndex,
        variant.isSupported,
        variant.flags,
      )
    ),
  };
}

export function getVariantPlatforms(variant: Variant): Set<ShaderPlatform> {
  return new Set(variant.shaders.map((s) => s.platform));
}

export function getVariantStages(variant: Variant): Set<ShaderStage> {
  return new Set(variant.shaders.map((s) => s.stage));
}

export function mergeVariant(base: Variant, other: Variant): Variant {
  const newShaders = [...base.shaders];
  for (const otherShader of other.shaders) {
    const existing = newShaders.find(
      (s) => s.platform === otherShader.platform && s.stage === otherShader.stage
    );
    if (!existing) {
      newShaders.push(otherShader);
    }
  }
  return { ...base, shaders: newShaders };
}

export function addPlatformsToVariant(
  variant: Variant,
  platforms: ReadonlySet<ShaderPlatform>,
): Variant {
  const currentPlatforms = getVariantPlatforms(variant);
  const stages = getVariantStages(variant);
  const newShaders = [...variant.shaders];

  for (const platform of platforms) {
    if (currentPlatforms.has(platform)) continue;
    for (const stage of stages) {
      const template = variant.shaders.find((s) => s.stage === stage);
      newShaders.push({
        stage,
        platform,
        inputs: template ? [...template.inputs] : [],
        hash: 0n,
        bgfxShader: createBgfxShader(),
      });
    }
  }

  return { ...variant, shaders: newShaders };
}

export function removePlatformsFromVariant(
  variant: Variant,
  platforms: ReadonlySet<ShaderPlatform>,
): Variant {
  return {
    ...variant,
    shaders: variant.shaders.filter((s) => !platforms.has(s.platform)),
  };
}
