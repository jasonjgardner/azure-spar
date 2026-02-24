import { BinaryReader } from "../binary/reader.ts";
import { BinaryWriter } from "../binary/writer.ts";
import { insertHeaderComment } from "../util.ts";
import {
  ShaderPlatform,
  SHADER_PLATFORM_NAMES,
  shaderPlatformFromName,
  ShaderStage,
  SHADER_STAGE_NAMES,
  shaderStageFromName,
  getPlatformValue,
  getPlatformName,
  getPlatformFileExtension,
} from "./enums.ts";
import {
  type BgfxShader,
  createBgfxShader,
  readBgfxShader,
  writeBgfxShader,
  serializeBgfxShaderProperties,
  loadBgfxShaderPropertiesFromJson,
} from "./bgfx-shader.ts";
import {
  type ShaderInput,
  readShaderInput,
  writeShaderInput,
  serializeShaderInputProperties,
  loadShaderInputFromJson,
  shaderInputsEqual,
} from "./shader-input.ts";

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder("utf-8");

export interface ShaderDefinition {
  readonly stage: ShaderStage;
  readonly platform: ShaderPlatform;
  readonly inputs: readonly ShaderInput[];
  readonly hash: bigint;
  readonly bgfxShader: BgfxShader;
}

export function createShaderDefinition(): ShaderDefinition {
  return {
    stage: ShaderStage.Unknown,
    platform: ShaderPlatform.Unknown,
    inputs: [],
    hash: 0n,
    bgfxShader: createBgfxShader(),
  };
}

export function readShaderDefinition(reader: BinaryReader, version: number): ShaderDefinition {
  const stageName = reader.readString();
  const platformName = reader.readString();
  const stage = shaderStageFromName(stageName);
  const platform = shaderPlatformFromName(platformName);

  const stageIndex = reader.readUbyte();
  if (stage !== stageIndex) {
    throw new Error(
      `Stage name "${stageName}" and index "${stageIndex}" do not match! Index "${stage}" was expected.`
    );
  }

  const platformIndex = reader.readUbyte();
  const expectedPlatformIndex = getPlatformValue(platform, version);
  if (expectedPlatformIndex !== platformIndex) {
    throw new Error(
      `Platform name "${platformName}" and index "${platformIndex}" do not match! Index "${expectedPlatformIndex}" was expected.`
    );
  }

  const inputCount = reader.readUshort();
  const inputs: ShaderInput[] = [];
  for (let i = 0; i < inputCount; i++) {
    inputs.push(readShaderInput(reader));
  }

  const hash = reader.readUlonglong();
  const bgfxShaderData = reader.readArray();
  const bgfxShader = readBgfxShader(bgfxShaderData, platform, stage);

  return { stage, platform, inputs, hash, bgfxShader };
}

export function writeShaderDefinition(
  writer: BinaryWriter,
  def: ShaderDefinition,
  version: number,
): void {
  writer.writeString(SHADER_STAGE_NAMES[def.stage]);
  writer.writeString(getPlatformName(def.platform, version));
  writer.writeUbyte(def.stage);
  writer.writeUbyte(getPlatformValue(def.platform, version));

  writer.writeUshort(def.inputs.length);
  for (const input of def.inputs) {
    writeShaderInput(writer, input);
  }

  writer.writeUlonglong(def.hash);

  const bgfxBytes = writeBgfxShader(def.platform, def.stage, def.bgfxShader);
  writer.writeArray(bgfxBytes);
}

export function getShaderFileName(def: ShaderDefinition, index: number): string {
  const platformName = SHADER_PLATFORM_NAMES[def.platform];
  const stageName = SHADER_STAGE_NAMES[def.stage];
  const ext = getPlatformFileExtension(def.platform);
  return `${index}.${platformName}.${stageName}.${ext}`;
}

export function serializeShaderDefinitionProperties(
  def: ShaderDefinition,
  index: number | null,
): Record<string, unknown> {
  const obj: Record<string, unknown> = {};
  if (index !== null) {
    obj["file_name"] = getShaderFileName(def, index);
  }
  obj["stage"] = SHADER_STAGE_NAMES[def.stage];
  obj["platform"] = SHADER_PLATFORM_NAMES[def.platform];
  obj["inputs"] = def.inputs.map(serializeShaderInputProperties);
  obj["hash"] = Number(def.hash);
  obj["bgfx_shader"] = serializeBgfxShaderProperties(def.bgfxShader);
  return obj;
}

export function serializeShaderDefinitionMinimal(
  def: ShaderDefinition,
  inputDefinitions: readonly ShaderInput[],
): unknown[] {
  return [
    def.stage,
    def.platform,
    def.inputs.map((inp) => {
      const idx = inputDefinitions.findIndex((d) => shaderInputsEqual(d, inp));
      return idx;
    }),
  ];
}

export function loadShaderDefinitionMinimal(
  arr: unknown[],
  inputDefinitions: readonly ShaderInput[],
): ShaderDefinition {
  const stage = arr[0] as ShaderStage;
  const platform = arr[1] as ShaderPlatform;
  const inputIndices = arr[2] as number[];
  const inputs = inputIndices.map((i) => ({ ...inputDefinitions[i]! }));

  return {
    stage,
    platform,
    inputs,
    hash: 0n,
    bgfxShader: createBgfxShader(),
  };
}

export function loadShaderDefinitionFromJson(
  obj: Record<string, unknown>,
  shaderBytes: Uint8Array,
): ShaderDefinition {
  const stage = shaderStageFromName(obj["stage"] as string);
  const platform = shaderPlatformFromName(obj["platform"] as string);
  const inputs = (obj["inputs"] as Record<string, unknown>[]).map(loadShaderInputFromJson);
  const hash = BigInt(obj["hash"] as number);

  const bgfxPropsObj = obj["bgfx_shader"] as Record<string, unknown>;
  const bgfxProps = loadBgfxShaderPropertiesFromJson(bgfxPropsObj);
  const bgfxShader: BgfxShader = { ...bgfxProps, shaderBytes };

  return { stage, platform, inputs, hash, bgfxShader };
}

export function labelShaderDefinition(
  def: ShaderDefinition,
  materialName: string,
  passName: string,
  variantIndex: number,
  isSupported: boolean,
  flags: Readonly<Record<string, string>>,
): ShaderDefinition {
  const platformName = SHADER_PLATFORM_NAMES[def.platform];
  if (
    !platformName.startsWith("ESSL") &&
    !platformName.startsWith("GLSL") &&
    platformName !== "Metal"
  ) {
    return def;
  }

  let comment =
    "// Shader Information:\n" +
    `// - Name: ${materialName}\n` +
    `// - Pass: ${passName}\n` +
    `// - Platform: ${platformName}\n` +
    `// - Stage: ${SHADER_STAGE_NAMES[def.stage]}\n` +
    `// - Variant: ${variantIndex}\n` +
    `// - Variant Supported: ${isSupported}\n`;

  const flagEntries = Object.entries(flags);
  if (flagEntries.length > 0) {
    comment += "// - Variant Flags: \n";
    comment += flagEntries.map(([flag, value]) => `//    - ${flag}: ${value}`).join("\n");
  }

  const code = TEXT_DECODER.decode(def.bgfxShader.shaderBytes);
  const labeled = insertHeaderComment(code, comment);

  return {
    ...def,
    bgfxShader: {
      ...def.bgfxShader,
      shaderBytes: TEXT_ENCODER.encode(labeled),
    },
  };
}
