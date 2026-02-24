import type { BinaryReader } from "../binary/reader.ts";
import type { BinaryWriter } from "../binary/writer.ts";
import {
  InputType,
  INPUT_TYPE_NAMES,
  inputTypeFromName,
  Interpolation,
  INTERPOLATION_NAMES,
  interpolationFromName,
  Precision,
  PRECISION_NAMES,
  precisionFromName,
  type InputSemantic,
  createInputSemantic,
  getSemanticName,
  semanticFromName,
} from "./enums.ts";

export interface ShaderInput {
  readonly name: string;
  readonly type: InputType;
  readonly semantic: InputSemantic;
  readonly perInstance: boolean;
  readonly precision: Precision;
  readonly interpolation: Interpolation;
}

export function createShaderInput(partial?: Partial<ShaderInput>): ShaderInput {
  return {
    name: "",
    type: InputType.Float,
    semantic: createInputSemantic(),
    perInstance: false,
    precision: Precision.None,
    interpolation: Interpolation.None,
    ...partial,
  };
}

export function shaderInputsEqual(a: ShaderInput, b: ShaderInput): boolean {
  return (
    a.name === b.name &&
    a.type === b.type &&
    a.semantic.index === b.semantic.index &&
    a.semantic.subIndex === b.semantic.subIndex &&
    a.perInstance === b.perInstance &&
    a.precision === b.precision &&
    a.interpolation === b.interpolation
  );
}

export function readShaderInput(reader: BinaryReader): ShaderInput {
  const name = reader.readString();
  const type = reader.readUbyte() as InputType;
  const semantic = createInputSemantic(reader.readUbyte(), reader.readUbyte());
  const perInstance = reader.readBool();

  const precision = reader.readBool()
    ? (reader.readUbyte() as Precision)
    : Precision.None;

  const interpolation = reader.readBool()
    ? (reader.readUbyte() as Interpolation)
    : Interpolation.None;

  return { name, type, semantic, perInstance, precision, interpolation };
}

export function writeShaderInput(writer: BinaryWriter, input: ShaderInput): void {
  writer.writeString(input.name);
  writer.writeUbyte(input.type);
  writer.writeUbyte(input.semantic.index);
  writer.writeUbyte(input.semantic.subIndex);
  writer.writeBool(input.perInstance);

  writer.writeBool(input.precision !== Precision.None);
  if (input.precision !== Precision.None) {
    writer.writeUbyte(input.precision);
  }

  writer.writeBool(input.interpolation !== Interpolation.None);
  if (input.interpolation !== Interpolation.None) {
    writer.writeUbyte(input.interpolation);
  }
}

export function serializeShaderInputProperties(input: ShaderInput): Record<string, unknown> {
  return {
    name: input.name,
    type: INPUT_TYPE_NAMES[input.type],
    semantic: getSemanticName(input.semantic),
    per_instance: input.perInstance,
    precision: input.precision !== Precision.None ? PRECISION_NAMES[input.precision] : "",
    interpolation: input.interpolation !== Interpolation.None ? INTERPOLATION_NAMES[input.interpolation] : "",
  };
}

export function loadShaderInputFromJson(obj: Record<string, unknown>): ShaderInput {
  return {
    name: obj["name"] as string,
    type: inputTypeFromName(obj["type"] as string),
    semantic: semanticFromName(obj["semantic"] as string),
    perInstance: obj["per_instance"] as boolean,
    precision: (obj["precision"] as string) ? precisionFromName(obj["precision"] as string) : Precision.None,
    interpolation: (obj["interpolation"] as string) ? interpolationFromName(obj["interpolation"] as string) : Interpolation.None,
  };
}

export function serializeShaderInputMinimal(input: ShaderInput): unknown[] {
  return [
    input.name,
    input.type,
    input.semantic.index,
    input.semantic.subIndex,
    input.perInstance ? 1 : 0,
    input.precision !== Precision.None ? input.precision : -1,
    input.interpolation !== Interpolation.None ? input.interpolation : -1,
  ];
}

export function loadShaderInputMinimal(arr: unknown[]): ShaderInput {
  return {
    name: arr[0] as string,
    type: arr[1] as InputType,
    semantic: createInputSemantic(arr[2] as number, arr[3] as number),
    perInstance: Boolean(arr[4]),
    precision: (arr[5] as number) !== -1 ? (arr[5] as Precision) : Precision.None,
    interpolation: (arr[6] as number) !== -1 ? (arr[6] as Interpolation) : Interpolation.None,
  };
}
