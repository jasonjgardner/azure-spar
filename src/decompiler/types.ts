import type { ShaderCode, ShaderFlags } from "../types.ts";

export interface InputVariant {
  readonly code: ShaderCode;
  readonly flags: ShaderFlags;
}
