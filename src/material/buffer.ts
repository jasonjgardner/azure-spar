import type { BinaryReader } from "../binary/reader.ts";
import type { BinaryWriter } from "../binary/writer.ts";
import {
  BufferType,
  BUFFER_TYPE_NAMES,
  bufferTypeFromName,
  BufferAccess,
  BUFFER_ACCESS_NAMES,
  bufferAccessFromName,
  Precision,
  PRECISION_NAMES,
  precisionFromName,
  TextureFilter,
  TEXTURE_FILTER_NAMES,
  textureFilterFromName,
  TextureWrap,
  TEXTURE_WRAP_NAMES,
  textureWrapFromName,
} from "./enums.ts";

export interface SamplerState {
  readonly filter: TextureFilter;
  readonly wrapping: TextureWrap;
}

export function createSamplerState(value = 0): SamplerState {
  if (value < 0 || value > 3) {
    throw new Error(`Sampler state intrinsic value ${value} is outside of accepted range!`);
  }
  return {
    filter: (value & 1) as TextureFilter,
    wrapping: ((value >> 1) & 1) as TextureWrap,
  };
}

export function getSamplerStateValue(state: SamplerState): number {
  return state.filter | (state.wrapping << 1);
}

export interface CustomTypeInfo {
  readonly struct: string;
  readonly size: number;
}

export interface MaterialBuffer {
  readonly name: string;
  readonly reg1: number;
  readonly access: BufferAccess;
  readonly precision: Precision;
  readonly unorderedAccess: boolean;
  readonly type: BufferType;
  readonly textureFormat: string;
  readonly alwaysOne: number;
  readonly reg2: number;
  readonly samplerState: SamplerState | null;
  readonly defaultTexture: string;
  readonly texturePath: string;
  readonly customTypeInfo: CustomTypeInfo | null;
}

export function readMaterialBuffer(reader: BinaryReader, _version: number): MaterialBuffer {
  const name = reader.readString();
  const reg1 = reader.readUshort();
  const access = reader.readUbyte() as BufferAccess;
  const precision = reader.readUbyte() as Precision;
  const unorderedAccess = reader.readBool();
  const type = reader.readUbyte() as BufferType;
  const textureFormat = reader.readString();
  const alwaysOne = reader.readUlong();
  const reg2 = reader.readUbyte();

  const samplerState = reader.readBool() ? createSamplerState(reader.readUbyte()) : null;

  const defaultTexture = reader.readBool() ? reader.readString() : "";
  const texturePath = reader.readBool() ? reader.readString() : "";

  const customTypeInfo = reader.readBool()
    ? { struct: reader.readString(), size: reader.readUlong() }
    : null;

  return {
    name, reg1, access, precision, unorderedAccess, type,
    textureFormat, alwaysOne, reg2, samplerState,
    defaultTexture, texturePath, customTypeInfo,
  };
}

export function writeMaterialBuffer(writer: BinaryWriter, buf: MaterialBuffer, _version: number): void {
  writer.writeString(buf.name);
  writer.writeUshort(buf.reg1);
  writer.writeUbyte(buf.access);
  writer.writeUbyte(buf.precision);
  writer.writeBool(buf.unorderedAccess);
  writer.writeUbyte(buf.type);
  writer.writeString(buf.textureFormat);
  writer.writeUlong(buf.alwaysOne);
  writer.writeUbyte(buf.reg2);

  writer.writeBool(buf.samplerState !== null);
  if (buf.samplerState !== null) {
    writer.writeUbyte(getSamplerStateValue(buf.samplerState));
  }

  writer.writeBool(buf.defaultTexture !== "");
  if (buf.defaultTexture !== "") {
    writer.writeString(buf.defaultTexture);
  }

  writer.writeBool(buf.texturePath !== "");
  if (buf.texturePath !== "") {
    writer.writeString(buf.texturePath);
  }

  writer.writeBool(buf.customTypeInfo !== null);
  if (buf.customTypeInfo !== null) {
    writer.writeString(buf.customTypeInfo.struct);
    writer.writeUlong(buf.customTypeInfo.size);
  }
}

export function serializeBufferProperties(buf: MaterialBuffer): Record<string, unknown> {
  return {
    name: buf.name,
    reg1: buf.reg1,
    reg2: buf.reg2,
    type: BUFFER_TYPE_NAMES[buf.type],
    precision: PRECISION_NAMES[buf.precision],
    access: BUFFER_ACCESS_NAMES[buf.access],
    texture_format: buf.textureFormat,
    default_texture: buf.defaultTexture,
    unordered_access: buf.unorderedAccess,
    always_one: buf.alwaysOne,
    texture_path: buf.texturePath,
    sampler_state: buf.samplerState
      ? { filter: TEXTURE_FILTER_NAMES[buf.samplerState.filter], wrapping: TEXTURE_WRAP_NAMES[buf.samplerState.wrapping] }
      : {},
    custom_type_info: buf.customTypeInfo
      ? { struct: buf.customTypeInfo.struct, size: buf.customTypeInfo.size }
      : {},
  };
}

export function serializeBufferMinimal(buf: MaterialBuffer): unknown[] {
  const arr: unknown[] = [
    buf.name, buf.reg1, buf.reg2, buf.type, buf.precision, buf.access,
    buf.textureFormat, buf.defaultTexture, buf.unorderedAccess ? 1 : 0,
    buf.alwaysOne, buf.texturePath,
    buf.samplerState !== null ? getSamplerStateValue(buf.samplerState) : -1,
  ];
  if (buf.customTypeInfo !== null) {
    arr.push(buf.customTypeInfo.struct);
    arr.push(buf.customTypeInfo.size);
  }
  return arr;
}

export function loadBufferMinimal(arr: unknown[]): MaterialBuffer {
  return {
    name: arr[0] as string,
    reg1: arr[1] as number,
    reg2: arr[2] as number,
    type: arr[3] as BufferType,
    precision: arr[4] as Precision,
    access: arr[5] as BufferAccess,
    textureFormat: arr[6] as string,
    defaultTexture: arr[7] as string,
    unorderedAccess: Boolean(arr[8]),
    alwaysOne: arr[9] as number,
    texturePath: arr[10] as string,
    samplerState: (arr[11] as number) !== -1 ? createSamplerState(arr[11] as number) : null,
    customTypeInfo: arr.length > 12 ? { struct: arr[12] as string, size: arr[13] as number } : null,
  };
}

export function loadBufferFromJson(obj: Record<string, unknown>): MaterialBuffer {
  const samplerObj = obj["sampler_state"] as Record<string, string> | undefined;
  const customObj = obj["custom_type_info"] as Record<string, unknown> | undefined;

  return {
    name: (obj["name"] as string) ?? "",
    reg1: (obj["reg1"] as number) ?? 0,
    reg2: (obj["reg2"] as number) ?? 0,
    type: bufferTypeFromName((obj["type"] as string) ?? "texture2D"),
    precision: precisionFromName((obj["precision"] as string) ?? "lowp"),
    access: bufferAccessFromName((obj["access"] as string) ?? "readonly"),
    textureFormat: (obj["texture_format"] as string) ?? "",
    defaultTexture: (obj["default_texture"] as string) ?? "",
    unorderedAccess: (obj["unordered_access"] as boolean) ?? false,
    alwaysOne: (obj["always_one"] as number) ?? 1,
    texturePath: (obj["texture_path"] as string) ?? "",
    samplerState: samplerObj && Object.keys(samplerObj).length > 0
      ? {
          filter: textureFilterFromName(samplerObj["filter"] ?? "Point"),
          wrapping: textureWrapFromName(samplerObj["wrapping"] ?? "Clamp"),
        }
      : null,
    customTypeInfo: customObj && Object.keys(customObj).length > 0
      ? { struct: (customObj["struct"] as string) ?? "", size: (customObj["size"] as number) ?? 0 }
      : null,
  };
}
