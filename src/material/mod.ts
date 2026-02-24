// Core material types and I/O
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
  MAGIC,
  EXTENSION,
  JSON_EXTENSION,
  JSON_FORMAT_VERSION,
  INITIAL_VERSION,
  LATEST_VERSION,
} from "./material.ts";

// Enums
export {
  ShaderStage,
  SHADER_STAGE_NAMES,
  shaderStageFromName,
  ShaderPlatform,
  SHADER_PLATFORM_NAMES,
  shaderPlatformFromName,
  getPlatformValue,
  getPlatformName,
  getPlatformList,
  platformFromIndex,
  getPlatformFileExtension,
  EncryptionType,
  Precision,
  PRECISION_NAMES,
  precisionFromName,
  BlendMode,
  BLEND_MODE_NAMES,
  BufferType,
  BUFFER_TYPE_NAMES,
  BufferAccess,
  BUFFER_ACCESS_NAMES,
  TextureFilter,
  TextureWrap,
  UniformType,
  UNIFORM_TYPE_NAMES,
  InputType,
  INPUT_TYPE_NAMES,
  Interpolation,
  INTERPOLATION_NAMES,
  type InputSemantic,
  createInputSemantic,
  getSemanticName,
  getSemanticVariableName,
  semanticFromName,
  semanticsEqual,
} from "./enums.ts";

// Data structures
export { type MaterialBuffer, readMaterialBuffer, writeMaterialBuffer } from "./buffer.ts";
export { type SamplerState, type CustomTypeInfo } from "./buffer.ts";
export { type Uniform, readUniform, writeUniform } from "./uniform.ts";
export { type Pass, readPass, writePass } from "./pass.ts";
export { type Variant, readVariant, writeVariant } from "./variant.ts";
export { type ShaderDefinition, readShaderDefinition, writeShaderDefinition } from "./shader-definition.ts";
export { type BgfxShader, type BgfxUniform, readBgfxShader, writeBgfxShader } from "./bgfx-shader.ts";
export { type ShaderInput, readShaderInput, writeShaderInput, shaderInputsEqual } from "./shader-input.ts";
export { type SupportedPlatforms, parseSupportedPlatforms, getSupportedPlatformsBitString } from "./supported-platforms.ts";

// Serialization
export {
  serializeMaterialProperties,
  serializeMinimal,
  loadMinimal,
  restoreShaders,
  restoreVaryingDef,
  type RestoreShaderOptions,
  type RestoredShader,
} from "./serialization.ts";
