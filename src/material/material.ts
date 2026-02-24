import { BinaryReader } from "../binary/reader.ts";
import { BinaryWriter } from "../binary/writer.ts";
import { MaterialFormatError, UnsupportedVersionError, EncryptionError } from "../errors.ts";
import { EncryptionType, ShaderPlatform, ShaderStage } from "./enums.ts";
import {
  readEncryptionType,
  writeEncryptionType,
  decryptAesGcm,
  encryptAesGcm,
} from "./encryption.ts";
import { type MaterialBuffer, readMaterialBuffer, writeMaterialBuffer } from "./buffer.ts";
import { type Uniform, readUniform, writeUniform } from "./uniform.ts";
import { type Pass, readPass, writePass, labelPass, sortPassVariants, getPassPlatforms, getPassStages, getPassFlagDefinitions } from "./pass.ts";

export const MAGIC = 168942106n;
export const COMPILED_MATERIAL_DEFINITION = "RenderDragon.CompiledMaterialDefinition";
export const INITIAL_VERSION = 22;
export const LATEST_VERSION = 25;
export const EXTENSION = ".material.bin";
export const JSON_EXTENSION = ".material.json";
export const JSON_FORMAT_VERSION = 1;

export interface Material {
  readonly version: number;
  readonly name: string;
  readonly encryption: EncryptionType;
  readonly parent: string;
  readonly buffers: readonly MaterialBuffer[];
  readonly uniforms: readonly Uniform[];
  readonly uniformOverrides: Readonly<Record<string, string>>;
  readonly passes: readonly Pass[];
  readonly encryptionKey: Uint8Array;
  readonly encryptionNonce: Uint8Array;
}

export function createMaterial(partial?: Partial<Material>): Material {
  return {
    version: LATEST_VERSION,
    name: "",
    encryption: EncryptionType.NONE,
    parent: "",
    buffers: [],
    uniforms: [],
    uniformOverrides: {},
    passes: [],
    encryptionKey: new Uint8Array(0),
    encryptionNonce: new Uint8Array(0),
    ...partial,
  };
}

export async function readMaterial(data: Uint8Array): Promise<Material> {
  const reader = new BinaryReader(data);

  // Validate magic
  const magic = reader.readUlonglong();
  if (magic !== MAGIC) {
    throw new MaterialFormatError("Failed to match file magic");
  }

  // Validate definition
  const definition = reader.readString();
  if (definition !== COMPILED_MATERIAL_DEFINITION) {
    throw new MaterialFormatError("Failed to recognize file as material");
  }

  // Read version
  const version = Number(reader.readUlonglong());
  if (version < INITIAL_VERSION || version > LATEST_VERSION) {
    throw new UnsupportedVersionError(version);
  }

  // Read encryption type
  const encryption = readEncryptionType(reader);

  let encryptionKey = new Uint8Array(0);
  let encryptionNonce = new Uint8Array(0);
  let bodyReader: BinaryReader;

  if (encryption === EncryptionType.SIMPLE_PASSPHRASE) {
    encryptionKey = new Uint8Array(reader.readArray());
    encryptionNonce = new Uint8Array(reader.readArray());
    const encryptedData = reader.readArray();
    const decrypted = await decryptAesGcm(encryptionKey, encryptionNonce, encryptedData);
    bodyReader = new BinaryReader(decrypted);
  } else if (encryption === EncryptionType.KEY_PAIR) {
    throw new EncryptionError("KEY_PAIR encryption is not supported");
  } else {
    bodyReader = reader;
  }

  // Read remaining material data
  const name = bodyReader.readString();
  const parent = bodyReader.readBool() ? bodyReader.readString() : "";

  // Read buffers
  const bufferCount = bodyReader.readUbyte();
  const buffers: MaterialBuffer[] = [];
  for (let i = 0; i < bufferCount; i++) {
    buffers.push(readMaterialBuffer(bodyReader, version));
  }

  // Read uniforms
  const uniformCount = bodyReader.readUshort();
  const uniforms: Uniform[] = [];
  for (let i = 0; i < uniformCount; i++) {
    uniforms.push(readUniform(bodyReader, version));
  }

  // Read uniform overrides (missing in "Core/Builtins")
  const uniformOverrides: Record<string, string> = {};
  if (name !== "Core/Builtins") {
    const overrideCount = bodyReader.readUshort();
    for (let i = 0; i < overrideCount; i++) {
      const uniformName = bodyReader.readString();
      uniformOverrides[uniformName] = bodyReader.readString();
    }
  }

  // Read passes
  const passCount = bodyReader.readUshort();
  const passes: Pass[] = [];
  for (let i = 0; i < passCount; i++) {
    passes.push(readPass(bodyReader, version));
  }

  // Validate trailing magic
  const trailingMagic = bodyReader.readUlonglong();
  if (trailingMagic !== MAGIC) {
    throw new MaterialFormatError("Failed to match trailing file magic");
  }

  return {
    version,
    name,
    encryption,
    parent,
    buffers,
    uniforms,
    uniformOverrides,
    passes,
    encryptionKey,
    encryptionNonce,
  };
}

export async function writeMaterial(material: Material): Promise<Uint8Array> {
  const writer = new BinaryWriter();

  writer.writeUlonglong(MAGIC);
  writer.writeString(COMPILED_MATERIAL_DEFINITION);
  writer.writeUlonglong(BigInt(material.version));

  writeEncryptionType(writer, material.encryption);

  if (material.encryption === EncryptionType.SIMPLE_PASSPHRASE) {
    writer.writeArray(material.encryptionKey);
    writer.writeArray(material.encryptionNonce);

    const bodyWriter = new BinaryWriter();
    writeRemainingBody(bodyWriter, material);
    const bodyBytes = bodyWriter.toUint8Array();
    const encrypted = await encryptAesGcm(material.encryptionKey, material.encryptionNonce, bodyBytes);
    writer.writeArray(encrypted);
  } else if (material.encryption === EncryptionType.KEY_PAIR) {
    throw new EncryptionError("KEY_PAIR encryption is not supported");
  } else {
    writeRemainingBody(writer, material);
  }

  return writer.toUint8Array();
}

function writeRemainingBody(writer: BinaryWriter, material: Material): void {
  writer.writeString(material.name);

  writer.writeBool(material.parent !== "");
  if (material.parent !== "") {
    writer.writeString(material.parent);
  }

  // Buffers
  writer.writeUbyte(material.buffers.length);
  for (const buffer of material.buffers) {
    writeMaterialBuffer(writer, buffer, material.version);
  }

  // Uniforms
  writer.writeUshort(material.uniforms.length);
  for (const uniform of material.uniforms) {
    writeUniform(writer, uniform, material.version);
  }

  // Uniform overrides
  if (material.name !== "Core/Builtins") {
    const entries = Object.entries(material.uniformOverrides);
    writer.writeUshort(entries.length);
    for (const [uniformName, overrideId] of entries) {
      writer.writeString(uniformName);
      writer.writeString(overrideId);
    }
  }

  // Passes
  writer.writeUshort(material.passes.length);
  for (const pass of material.passes) {
    writePass(writer, pass, material.version);
  }

  // Trailing magic
  writer.writeUlonglong(MAGIC);
}

// --- Utility functions ---

export function labelMaterial(material: Material): Material {
  return {
    ...material,
    passes: material.passes.map((p) => labelPass(p, material.name)),
  };
}

export function sortMaterialVariants(material: Material): Material {
  return {
    ...material,
    passes: material.passes.map(sortPassVariants),
  };
}

export function getMaterialPlatforms(material: Material): Set<ShaderPlatform> {
  const platforms = new Set<ShaderPlatform>();
  for (const pass of material.passes) {
    for (const p of getPassPlatforms(pass)) {
      platforms.add(p);
    }
  }
  return platforms;
}

export function getMaterialStages(material: Material): Set<ShaderStage> {
  const stages = new Set<ShaderStage>();
  for (const pass of material.passes) {
    for (const s of getPassStages(pass)) {
      stages.add(s);
    }
  }
  return stages;
}

export function getMaterialFlagDefinitions(material: Material): Record<string, Set<string>> {
  const definitions: Record<string, Set<string>> = {};
  for (const pass of material.passes) {
    const passDefs = getPassFlagDefinitions(pass);
    for (const [key, values] of Object.entries(passDefs)) {
      if (!definitions[key]) definitions[key] = new Set();
      for (const v of values) {
        definitions[key]!.add(v);
      }
    }
  }
  return definitions;
}
