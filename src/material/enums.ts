// --- Shader Stage ---

export enum ShaderStage {
  Vertex = 0,
  Fragment = 1,
  Compute = 2,
  Unknown = 3,
}

export const SHADER_STAGE_NAMES: Record<ShaderStage, string> = {
  [ShaderStage.Vertex]: "Vertex",
  [ShaderStage.Fragment]: "Fragment",
  [ShaderStage.Compute]: "Compute",
  [ShaderStage.Unknown]: "Unknown",
};

export function shaderStageFromName(name: string): ShaderStage {
  const entry = Object.entries(SHADER_STAGE_NAMES).find(([, v]) => v === name);
  if (!entry) throw new Error(`Unknown shader stage: ${name}`);
  return Number(entry[0]) as ShaderStage;
}

// --- Shader Platform ---

export enum ShaderPlatform {
  Direct3D_SM40 = 1,
  Direct3D_SM50 = 2,
  Direct3D_SM60 = 3,
  Direct3D_SM65 = 4,
  Direct3D_XB1 = 5,
  Direct3D_XBX = 6,
  GLSL_120 = 7,
  GLSL_430 = 8,
  ESSL_300 = 9,
  ESSL_310 = 10,
  Metal = 11,
  Vulkan = 12,
  Nvn = 13,
  PSSL = 14,
  Unknown = 15,
}

export const SHADER_PLATFORM_NAMES: Record<ShaderPlatform, string> = {
  [ShaderPlatform.Direct3D_SM40]: "Direct3D_SM40",
  [ShaderPlatform.Direct3D_SM50]: "Direct3D_SM50",
  [ShaderPlatform.Direct3D_SM60]: "Direct3D_SM60",
  [ShaderPlatform.Direct3D_SM65]: "Direct3D_SM65",
  [ShaderPlatform.Direct3D_XB1]: "Direct3D_XB1",
  [ShaderPlatform.Direct3D_XBX]: "Direct3D_XBX",
  [ShaderPlatform.GLSL_120]: "GLSL_120",
  [ShaderPlatform.GLSL_430]: "GLSL_430",
  [ShaderPlatform.ESSL_300]: "ESSL_300",
  [ShaderPlatform.ESSL_310]: "ESSL_310",
  [ShaderPlatform.Metal]: "Metal",
  [ShaderPlatform.Vulkan]: "Vulkan",
  [ShaderPlatform.Nvn]: "Nvn",
  [ShaderPlatform.PSSL]: "PSSL",
  [ShaderPlatform.Unknown]: "Unknown",
};

export function shaderPlatformFromName(name: string): ShaderPlatform {
  const entry = Object.entries(SHADER_PLATFORM_NAMES).find(([, v]) => v === name);
  if (!entry) throw new Error(`Unknown shader platform: ${name}`);
  return Number(entry[0]) as ShaderPlatform;
}

type PlatformMapping = Map<ShaderPlatform, number | ShaderPlatform>;

function platformMapping(version: number): PlatformMapping {
  if (version >= 25) {
    return new Map<ShaderPlatform, number | ShaderPlatform>([
      [ShaderPlatform.Direct3D_SM40, 0],
      [ShaderPlatform.Direct3D_SM50, 1],
      [ShaderPlatform.Direct3D_SM60, 2],
      [ShaderPlatform.Direct3D_SM65, 3],
      [ShaderPlatform.Direct3D_XB1, 4],
      [ShaderPlatform.Direct3D_XBX, 5],
      [ShaderPlatform.GLSL_120, 6],
      [ShaderPlatform.GLSL_430, 7],
      [ShaderPlatform.ESSL_310, 8],
      [ShaderPlatform.Metal, 9],
      [ShaderPlatform.Vulkan, 10],
      [ShaderPlatform.Nvn, 11],
      [ShaderPlatform.PSSL, 12],
      [ShaderPlatform.Unknown, 13],
      // Platform conversion
      [ShaderPlatform.ESSL_300, ShaderPlatform.ESSL_310],
    ]);
  }

  return new Map<ShaderPlatform, number | ShaderPlatform>([
    [ShaderPlatform.Direct3D_SM40, 0],
    [ShaderPlatform.Direct3D_SM50, 1],
    [ShaderPlatform.Direct3D_SM60, 2],
    [ShaderPlatform.Direct3D_SM65, 3],
    [ShaderPlatform.Direct3D_XB1, 4],
    [ShaderPlatform.Direct3D_XBX, 5],
    [ShaderPlatform.GLSL_120, 6],
    [ShaderPlatform.GLSL_430, 7],
    [ShaderPlatform.ESSL_300, 8],
    [ShaderPlatform.ESSL_310, 9],
    [ShaderPlatform.Metal, 10],
    [ShaderPlatform.Vulkan, 11],
    [ShaderPlatform.Nvn, 12],
    [ShaderPlatform.PSSL, 13],
    [ShaderPlatform.Unknown, 14],
  ]);
}

export function getPlatformValue(platform: ShaderPlatform, version: number): number {
  const mapping = platformMapping(version);
  let value = mapping.get(platform);

  if (typeof value !== "number" && value !== undefined) {
    value = mapping.get(value);
  }

  if (typeof value !== "number") {
    throw new Error(
      `Platform ${SHADER_PLATFORM_NAMES[platform]} is not supported in version ${version} or there are no conversions available!`
    );
  }

  return value;
}

export function getPlatformName(platform: ShaderPlatform, version: number): string {
  const mapping = platformMapping(version);
  const value = mapping.get(platform);

  if (typeof value === "number") return SHADER_PLATFORM_NAMES[platform];
  if (value !== undefined) return SHADER_PLATFORM_NAMES[value];

  throw new Error(
    `Platform ${SHADER_PLATFORM_NAMES[platform]} is not supported in version ${version} or there are no conversions available!`
  );
}

export function getPlatformList(version: number): ShaderPlatform[] {
  const result: ShaderPlatform[] = [];
  for (const [platform, value] of platformMapping(version)) {
    if (typeof value === "number") {
      result.push(platform);
    }
  }
  return result;
}

export function platformFromIndex(index: number, version: number): ShaderPlatform {
  for (const [platform, value] of platformMapping(version)) {
    if (value === index) return platform;
  }
  throw new Error(`No platform found for index ${index} in version ${version}`);
}

export function getPlatformFileExtension(platform: ShaderPlatform): string {
  const name = SHADER_PLATFORM_NAMES[platform];

  if (name.startsWith("Direct3D")) return "dxbc";
  if (name.startsWith("GLSL") || name.startsWith("ESSL")) return "glsl";
  if (name === "Metal") return "metal";
  if (name === "Vulkan") return "spirv";

  return "bin";
}

// --- Encryption Type ---

export enum EncryptionType {
  NONE = "NONE",
  SIMPLE_PASSPHRASE = "SMPL",
  KEY_PAIR = "KYPR",
}

// --- Precision ---

export enum Precision {
  None = -1,
  Lowp = 0,
  Mediump = 1,
  Highp = 2,
}

export const PRECISION_NAMES: Record<Precision, string> = {
  [Precision.None]: "none",
  [Precision.Lowp]: "lowp",
  [Precision.Mediump]: "mediump",
  [Precision.Highp]: "highp",
};

export function precisionFromName(name: string): Precision {
  const entry = Object.entries(PRECISION_NAMES).find(([, v]) => v === name);
  if (!entry) throw new Error(`Unknown precision: ${name}`);
  return Number(entry[0]) as Precision;
}

// --- Blend Mode ---

export enum BlendMode {
  Unspecified = -1,
  NoneMode = 0,
  Replace = 1,
  AlphaBlend = 2,
  ColorBlendAlphaAdd = 3,
  PreMultiplied = 4,
  InvertColor = 5,
  Additive = 6,
  AdditiveAlpha = 7,
  Multiply = 8,
  MultiplyBoth = 9,
  InverseSrcAlpha = 10,
  SrcAlpha = 11,
}

export const BLEND_MODE_NAMES: Record<BlendMode, string> = {
  [BlendMode.Unspecified]: "Unspecified",
  [BlendMode.NoneMode]: "NoneMode",
  [BlendMode.Replace]: "Replace",
  [BlendMode.AlphaBlend]: "AlphaBlend",
  [BlendMode.ColorBlendAlphaAdd]: "ColorBlendAlphaAdd",
  [BlendMode.PreMultiplied]: "PreMultiplied",
  [BlendMode.InvertColor]: "InvertColor",
  [BlendMode.Additive]: "Additive",
  [BlendMode.AdditiveAlpha]: "AdditiveAlpha",
  [BlendMode.Multiply]: "Multiply",
  [BlendMode.MultiplyBoth]: "MultiplyBoth",
  [BlendMode.InverseSrcAlpha]: "InverseSrcAlpha",
  [BlendMode.SrcAlpha]: "SrcAlpha",
};

// --- Buffer Type ---

export enum BufferType {
  Texture2D = 0,
  Texture2DArray = 1,
  External2D = 2,
  Texture3D = 3,
  TextureCube = 4,
  TextureCubeArray = 5,
  StructBuffer = 6,
  RawBuffer = 7,
  AccelerationStructure = 8,
  Shadow2D = 9,
  Shadow2DArray = 10,
}

export const BUFFER_TYPE_NAMES: Record<BufferType, string> = {
  [BufferType.Texture2D]: "texture2D",
  [BufferType.Texture2DArray]: "texture2DArray",
  [BufferType.External2D]: "external2D",
  [BufferType.Texture3D]: "texture3D",
  [BufferType.TextureCube]: "textureCube",
  [BufferType.TextureCubeArray]: "textureCubeArray",
  [BufferType.StructBuffer]: "structBuffer",
  [BufferType.RawBuffer]: "rawBuffer",
  [BufferType.AccelerationStructure]: "accelerationStructure",
  [BufferType.Shadow2D]: "shadow2D",
  [BufferType.Shadow2DArray]: "shadow2DArray",
};

export function bufferTypeFromName(name: string): BufferType {
  const entry = Object.entries(BUFFER_TYPE_NAMES).find(([, v]) => v === name);
  if (!entry) throw new Error(`Unknown buffer type: ${name}`);
  return Number(entry[0]) as BufferType;
}

// --- Buffer Access ---

export enum BufferAccess {
  Undefined = 0,
  Readonly = 1,
  Writeonly = 2,
  Readwrite = 3,
}

export const BUFFER_ACCESS_NAMES: Record<BufferAccess, string> = {
  [BufferAccess.Undefined]: "undefined",
  [BufferAccess.Readonly]: "readonly",
  [BufferAccess.Writeonly]: "writeonly",
  [BufferAccess.Readwrite]: "readwrite",
};

export function bufferAccessFromName(name: string): BufferAccess {
  const entry = Object.entries(BUFFER_ACCESS_NAMES).find(([, v]) => v === name);
  if (!entry) throw new Error(`Unknown buffer access: ${name}`);
  return Number(entry[0]) as BufferAccess;
}

// --- Texture Filter ---

export enum TextureFilter {
  Point = 0,
  Bilinear = 1,
}

export const TEXTURE_FILTER_NAMES: Record<TextureFilter, string> = {
  [TextureFilter.Point]: "Point",
  [TextureFilter.Bilinear]: "Bilinear",
};

export function textureFilterFromName(name: string): TextureFilter {
  const entry = Object.entries(TEXTURE_FILTER_NAMES).find(([, v]) => v === name);
  if (!entry) throw new Error(`Unknown texture filter: ${name}`);
  return Number(entry[0]) as TextureFilter;
}

// --- Texture Wrap ---

export enum TextureWrap {
  Clamp = 0,
  Repeat = 1,
}

export const TEXTURE_WRAP_NAMES: Record<TextureWrap, string> = {
  [TextureWrap.Clamp]: "Clamp",
  [TextureWrap.Repeat]: "Repeat",
};

export function textureWrapFromName(name: string): TextureWrap {
  const entry = Object.entries(TEXTURE_WRAP_NAMES).find(([, v]) => v === name);
  if (!entry) throw new Error(`Unknown texture wrap: ${name}`);
  return Number(entry[0]) as TextureWrap;
}

// --- Uniform Type ---

export enum UniformType {
  Vec4 = 2,
  Mat3 = 3,
  Mat4 = 4,
  External = 5,
}

export const UNIFORM_TYPE_NAMES: Record<UniformType, string> = {
  [UniformType.Vec4]: "vec4",
  [UniformType.Mat3]: "mat3",
  [UniformType.Mat4]: "mat4",
  [UniformType.External]: "external",
};

export function uniformTypeFromName(name: string): UniformType {
  const entry = Object.entries(UNIFORM_TYPE_NAMES).find(([, v]) => v === name);
  if (!entry) throw new Error(`Unknown uniform type: ${name}`);
  return Number(entry[0]) as UniformType;
}

// --- Input Type ---

export enum InputType {
  Float = 0,
  Vec2 = 1,
  Vec3 = 2,
  Vec4 = 3,
  Int = 4,
  Ivec2 = 5,
  Ivec3 = 6,
  Ivec4 = 7,
  Uint = 8,
  Uvec2 = 9,
  Uvec3 = 10,
  Uvec4 = 11,
  Mat4 = 12,
}

export const INPUT_TYPE_NAMES: Record<InputType, string> = {
  [InputType.Float]: "float",
  [InputType.Vec2]: "vec2",
  [InputType.Vec3]: "vec3",
  [InputType.Vec4]: "vec4",
  [InputType.Int]: "int",
  [InputType.Ivec2]: "ivec2",
  [InputType.Ivec3]: "ivec3",
  [InputType.Ivec4]: "ivec4",
  [InputType.Uint]: "uint",
  [InputType.Uvec2]: "uvec2",
  [InputType.Uvec3]: "uvec3",
  [InputType.Uvec4]: "uvec4",
  [InputType.Mat4]: "mat4",
};

export function inputTypeFromName(name: string): InputType {
  const entry = Object.entries(INPUT_TYPE_NAMES).find(([, v]) => v === name);
  if (!entry) throw new Error(`Unknown input type: ${name}`);
  return Number(entry[0]) as InputType;
}

// --- Interpolation ---

export enum Interpolation {
  None = -1,
  Flat = 0,
  Smooth = 1,
  Noperspective = 2,
  Centroid = 3,
}

export const INTERPOLATION_NAMES: Record<Interpolation, string> = {
  [Interpolation.None]: "none",
  [Interpolation.Flat]: "flat",
  [Interpolation.Smooth]: "smooth",
  [Interpolation.Noperspective]: "noperspective",
  [Interpolation.Centroid]: "centroid",
};

export function interpolationFromName(name: string): Interpolation {
  const entry = Object.entries(INTERPOLATION_NAMES).find(([, v]) => v === name);
  if (!entry) throw new Error(`Unknown interpolation: ${name}`);
  return Number(entry[0]) as Interpolation;
}

// --- Input Semantic ---

export interface SemanticType {
  readonly semantic: string;
  readonly variableName: string;
  readonly isRangeAllowed: boolean;
}

export const SEMANTIC_TYPES: readonly SemanticType[] = [
  { semantic: "POSITION", variableName: "position", isRangeAllowed: false },
  { semantic: "NORMAL", variableName: "normal", isRangeAllowed: false },
  { semantic: "TANGENT", variableName: "tangent", isRangeAllowed: false },
  { semantic: "BITANGENT", variableName: "bitangent", isRangeAllowed: false },
  { semantic: "COLOR", variableName: "color", isRangeAllowed: true },
  { semantic: "BLENDINDICES", variableName: "indices", isRangeAllowed: false },
  { semantic: "BLENDWEIGHT", variableName: "weight", isRangeAllowed: false },
  { semantic: "TEXCOORD", variableName: "texcoord", isRangeAllowed: true },
  { semantic: "UNKNOWN", variableName: "unknown", isRangeAllowed: true },
  { semantic: "FRONTFACING", variableName: "frontFacing", isRangeAllowed: false },
] as const;

export interface InputSemantic {
  readonly index: number;
  readonly subIndex: number;
}

export function createInputSemantic(index = 0, subIndex = 0): InputSemantic {
  return { index, subIndex };
}

export function getSemanticName(semantic: InputSemantic): string {
  const type = SEMANTIC_TYPES[semantic.index];
  if (!type) throw new Error(`Invalid semantic index: ${semantic.index}`);
  return type.semantic + (type.isRangeAllowed ? String(semantic.subIndex) : "");
}

export function getSemanticVariableName(semantic: InputSemantic): string {
  const type = SEMANTIC_TYPES[semantic.index];
  if (!type) throw new Error(`Invalid semantic index: ${semantic.index}`);
  return type.variableName + (type.isRangeAllowed ? String(semantic.subIndex) : "");
}

export function semanticFromName(name: string): InputSemantic {
  for (let i = 0; i < SEMANTIC_TYPES.length; i++) {
    const type = SEMANTIC_TYPES[i]!;
    if (!name.startsWith(type.semantic)) continue;

    const rest = name.slice(type.semantic.length);
    const subIndex = rest ? parseInt(rest, 10) : 0;
    return { index: i, subIndex };
  }
  return { index: 0, subIndex: 0 };
}

export function semanticsEqual(a: InputSemantic, b: InputSemantic): boolean {
  return a.index === b.index && a.subIndex === b.subIndex;
}
