import type { BgfxShader, BgfxUniform } from "../material/bgfx-shader.ts";

/** Options for wrapping compiled DXIL bytecode as a BgfxShader. */
export interface WrapDxilOptions {
  /** Compiled DXIL bytecode from DXC. */
  readonly dxilBytes: Uint8Array;
  /** BGFX uniform metadata (from shader reflection or manifest). */
  readonly uniforms?: readonly BgfxUniform[];
  /** CRC32 or DXC hash value. */
  readonly hash?: number;
  /** Vertex attribute semantic indices. */
  readonly attributes?: readonly number[];
  /** Vertex stride or size hint (-1 if not applicable). */
  readonly size?: number;
}

/**
 * Wrap compiled DXIL bytecode into the BgfxShader structure
 * expected by the RenderDragon material format.
 *
 * For Direct3D platforms (SM40-SM65), `shaderBytes` holds raw
 * DXBC/DXIL bytecode that is passed through to the binary writer
 * without transformation.
 */
export function wrapDxilAsBgfxShader(options: WrapDxilOptions): BgfxShader {
  return {
    hash: options.hash ?? 0,
    uniforms: options.uniforms ?? [],
    groupSize: [],
    shaderBytes: options.dxilBytes,
    attributes: options.attributes ?? [],
    size: options.size ?? -1,
  };
}
