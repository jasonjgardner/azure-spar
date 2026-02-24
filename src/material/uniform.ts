import type { BinaryReader } from "../binary/reader.ts";
import type { BinaryWriter } from "../binary/writer.ts";
import { UniformType, UNIFORM_TYPE_NAMES, uniformTypeFromName } from "./enums.ts";

export interface Uniform {
  readonly name: string;
  readonly type: UniformType;
  readonly count: number;
  readonly default: readonly number[];
}

const FLOAT_COUNTS: Record<number, number> = {
  [UniformType.Vec4]: 4,
  [UniformType.Mat3]: 9,
  [UniformType.Mat4]: 16,
};

export function readUniform(reader: BinaryReader, _version: number): Uniform {
  const name = reader.readString();
  const type = reader.readUshort() as UniformType;

  let count = 0;
  let hasData = false;
  let defaultValues: number[] = [];

  if (type >= 2 && type <= 4) {
    count = reader.readUlong();
    hasData = reader.readBool();
  }

  if (hasData) {
    const floatCount = FLOAT_COUNTS[type];
    if (floatCount) {
      defaultValues = reader.readFloat32Array(floatCount) as number[];
    }
  }

  if (type === UniformType.External) {
    // No extra data
  } else if (type < 2 || type > 5) {
    throw new Error(`Unrecognized uniform type "${type}"`);
  }

  return { name, type, count, default: defaultValues };
}

export function writeUniform(writer: BinaryWriter, uniform: Uniform, _version: number): void {
  writer.writeString(uniform.name);
  writer.writeUshort(uniform.type);

  if (uniform.type >= 2 && uniform.type <= 4) {
    writer.writeUlong(uniform.count);
    writer.writeBool(uniform.default.length > 0);
  }

  if (uniform.default.length > 0) {
    writer.writeFloat32Array(uniform.default);
  }
}

export function serializeUniformProperties(uniform: Uniform): Record<string, unknown> {
  return {
    name: uniform.name,
    type: UNIFORM_TYPE_NAMES[uniform.type],
    count: uniform.count,
    default: uniform.default,
  };
}

export function serializeUniformMinimal(uniform: Uniform): unknown[] {
  return [uniform.name, uniform.type, uniform.count, [...uniform.default]];
}

export function loadUniformMinimal(arr: unknown[]): Uniform {
  return {
    name: arr[0] as string,
    type: arr[1] as UniformType,
    count: arr[2] as number,
    default: arr[3] as number[],
  };
}

export function loadUniformFromJson(obj: Record<string, unknown>): Uniform {
  return {
    name: (obj["name"] as string) ?? "",
    type: uniformTypeFromName((obj["type"] as string) ?? "vec4"),
    count: (obj["count"] as number) ?? 0,
    default: (obj["default"] as number[]) ?? [],
  };
}
