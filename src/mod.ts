// ── Material I/O ────────────────────────────────────────────────
export {
  type Material,
  createMaterial,
  readMaterial,
  writeMaterial,
  labelMaterial,
  sortMaterialVariants,
  getMaterialPlatforms,
  getMaterialStages,
  getMaterialFlagDefinitions,
} from "./material/mod.ts";

// ── Serialization ───────────────────────────────────────────────
export {
  serializeMaterialProperties,
  serializeMinimal,
  loadMinimal,
  restoreShaders,
  restoreVaryingDef,
  type RestoreShaderOptions,
  type RestoredShader,
} from "./material/mod.ts";

// ── Decompiler ──────────────────────────────────────────────────
export {
  type InputVariant,
  restoreCode,
  type RestoreCodeOptions,
  type RestoreCodeResult,
  restoreVarying,
  generateVaryingLine,
} from "./decompiler/mod.ts";

// ── Enums ───────────────────────────────────────────────────────
export {
  ShaderStage,
  SHADER_STAGE_NAMES,
  ShaderPlatform,
  SHADER_PLATFORM_NAMES,
  EncryptionType,
  Precision,
  BlendMode,
  BufferType,
  BufferAccess,
  TextureFilter,
  TextureWrap,
  UniformType,
  InputType,
  Interpolation,
  type InputSemantic,
} from "./material/mod.ts";

// ── Data Structure Types ────────────────────────────────────────
export type { Pass } from "./material/mod.ts";
export type { Variant } from "./material/mod.ts";
export type { ShaderDefinition } from "./material/mod.ts";
export type { BgfxShader, BgfxUniform } from "./material/mod.ts";
export type { ShaderInput } from "./material/mod.ts";
export type { MaterialBuffer, SamplerState, CustomTypeInfo } from "./material/mod.ts";
export type { Uniform } from "./material/mod.ts";
export type { SupportedPlatforms } from "./material/mod.ts";

// ── Constants ───────────────────────────────────────────────────
export {
  MAGIC,
  EXTENSION,
  JSON_EXTENSION,
  JSON_FORMAT_VERSION,
  INITIAL_VERSION,
  LATEST_VERSION,
} from "./material/mod.ts";

// ── Type Aliases ────────────────────────────────────────────────
export type {
  FlagName,
  FlagValue,
  ShaderFlags,
  FlagDefinition,
  ShaderCode,
  FunctionName,
  ShaderLineIndex,
  ShaderLine,
} from "./types.ts";

// ── Errors ──────────────────────────────────────────────────────
export {
  MaterialError,
  MaterialFormatError,
  UnsupportedVersionError,
  EncryptionError,
  DecompilerError,
} from "./errors.ts";
