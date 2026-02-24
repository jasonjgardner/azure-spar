import { BinaryReader } from "../binary/reader.ts";
import { BinaryWriter } from "../binary/writer.ts";
import { ShaderPlatform, ShaderStage } from "./enums.ts";

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder("utf-8");

export interface BgfxUniform {
  readonly name: string;
  readonly typeBits: number;
  readonly count: number;
  readonly regIndex: number;
  readonly regCount: number;
}

export interface BgfxShader {
  readonly hash: number;
  readonly uniforms: readonly BgfxUniform[];
  readonly groupSize: readonly number[];
  readonly shaderBytes: Uint8Array;
  readonly attributes: readonly number[];
  readonly size: number;
}

export function createBgfxShader(): BgfxShader {
  return {
    hash: 0,
    uniforms: [],
    groupSize: [],
    shaderBytes: new Uint8Array(0),
    attributes: [],
    size: 0,
  };
}

function readBgfxUniform(reader: BinaryReader): BgfxUniform {
  const nameLength = reader.readUbyte();
  const nameBytes = reader.readBytes(nameLength);
  const name = TEXT_DECODER.decode(nameBytes);
  const typeBits = reader.readUbyte();
  const count = reader.readUbyte();
  const regIndex = reader.readUshort();
  const regCount = reader.readUshort();
  return { name, typeBits, count, regIndex, regCount };
}

function writeBgfxUniform(writer: BinaryWriter, uniform: BgfxUniform): void {
  const nameBytes = TEXT_ENCODER.encode(uniform.name);
  writer.writeUbyte(nameBytes.byteLength);
  writer.writeBytes(nameBytes);
  writer.writeUbyte(uniform.typeBits);
  writer.writeUbyte(uniform.count);
  writer.writeUshort(uniform.regIndex);
  writer.writeUshort(uniform.regCount);
}

export function readBgfxShader(
  data: Uint8Array,
  platform: ShaderPlatform,
  stage: ShaderStage,
): BgfxShader {
  const reader = new BinaryReader(data);

  const headerBytes = reader.readBytes(3);
  const header = TEXT_DECODER.decode(headerBytes);
  if (!["VSH", "FSH", "CSH"].includes(header)) {
    throw new Error(`Unrecognized BGFX shader bin header "${header}"`);
  }

  const version = reader.readUbyte();
  if (!(version === 5 || (version === 3 && header === "CSH"))) {
    throw new Error(`Unsupported BGFX shader bin version: ${version}`);
  }

  const hash = reader.readUlong();

  const uniformCount = reader.readUshort();
  const uniforms: BgfxUniform[] = [];
  for (let i = 0; i < uniformCount; i++) {
    uniforms.push(readBgfxUniform(reader));
  }

  let groupSize: number[] = [];
  if (platform === ShaderPlatform.Metal && stage === ShaderStage.Compute) {
    groupSize = [reader.readUshort(), reader.readUshort(), reader.readUshort()];
  }

  const shaderByteLength = reader.readUlong();
  const shaderBytes = reader.readBytes(shaderByteLength);
  reader.readUbyte(); // Padding (always 0)

  let attributes: number[] = [];
  let size = -1;

  if (reader.remaining > 0) {
    const attributeCount = reader.readUbyte();
    attributes = [];
    for (let i = 0; i < attributeCount; i++) {
      attributes.push(reader.readUshort());
    }
    size = reader.readUshort();
  }

  return { hash, uniforms, groupSize, shaderBytes, attributes, size };
}

export function writeBgfxShader(
  platform: ShaderPlatform,
  stage: ShaderStage,
  shader: BgfxShader,
): Uint8Array {
  const inner = new BinaryWriter();

  let header = "FSH";
  let version = 5;
  if (stage === ShaderStage.Vertex) {
    header = "VSH";
  } else if (stage === ShaderStage.Compute) {
    header = "CSH";
    version = 3;
  }

  inner.writeBytes(TEXT_ENCODER.encode(header));
  inner.writeUbyte(version);
  inner.writeUlong(shader.hash);

  inner.writeUshort(shader.uniforms.length);
  for (const uniform of shader.uniforms) {
    writeBgfxUniform(inner, uniform);
  }

  if (platform === ShaderPlatform.Metal && stage === ShaderStage.Compute) {
    for (let i = 0; i < 3; i++) {
      inner.writeUshort(shader.groupSize[i] ?? 0);
    }
  }

  inner.writeUlong(shader.shaderBytes.byteLength);
  inner.writeBytes(shader.shaderBytes);
  inner.writeUbyte(0); // Padding

  if (shader.size !== -1) {
    inner.writeUbyte(shader.attributes.length);
    for (const attr of shader.attributes) {
      inner.writeUshort(attr);
    }
    inner.writeUshort(shader.size);
  }

  return inner.toUint8Array();
}

export function serializeBgfxShaderProperties(shader: BgfxShader): Record<string, unknown> {
  return {
    hash: shader.hash,
    uniforms: shader.uniforms.map((u) => ({
      name: u.name,
      type_bits: u.typeBits,
      count: u.count,
      reg_index: u.regIndex,
      reg_count: u.regCount,
    })),
    group_size: shader.groupSize,
    attributes: shader.attributes,
    size: shader.size,
  };
}

export function loadBgfxUniformFromJson(obj: Record<string, unknown>): BgfxUniform {
  return {
    name: obj["name"] as string,
    typeBits: obj["type_bits"] as number,
    count: obj["count"] as number,
    regIndex: obj["reg_index"] as number,
    regCount: obj["reg_count"] as number,
  };
}

export function loadBgfxShaderPropertiesFromJson(
  bgfxObj: Record<string, unknown>,
): Omit<BgfxShader, "shaderBytes"> {
  const uniforms = (bgfxObj["uniforms"] as Record<string, unknown>[]).map(loadBgfxUniformFromJson);
  return {
    hash: bgfxObj["hash"] as number,
    uniforms,
    groupSize: bgfxObj["group_size"] as number[],
    attributes: bgfxObj["attributes"] as number[],
    size: bgfxObj["size"] as number,
  };
}
