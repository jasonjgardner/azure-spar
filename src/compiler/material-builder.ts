import type { BgfxShader } from "../material/bgfx-shader.ts";
import type { Material } from "../material/material.ts";
import { createMaterial, LATEST_VERSION } from "../material/material.ts";
import { BlendMode, EncryptionType, type ShaderPlatform, type ShaderStage } from "../material/enums.ts";
import { createSupportedPlatforms } from "../material/supported-platforms.ts";
import type { ShaderInput } from "../material/shader-input.ts";
import type { Pass } from "../material/pass.ts";
import type { Variant } from "../material/variant.ts";
import type { ShaderDefinition } from "../material/shader-definition.ts";

/** A single compiled shader ready to be placed in a material. */
export interface CompiledShader {
  readonly stage: ShaderStage;
  readonly platform: ShaderPlatform;
  readonly bgfxShader: BgfxShader;
  readonly inputs: readonly ShaderInput[];
}

/** Definition of a render pass containing compiled shaders. */
export interface PassDefinition {
  readonly name: string;
  readonly shaders: readonly CompiledShader[];
  readonly flags?: Readonly<Record<string, string>>;
  readonly defaultBlendMode?: BlendMode;
}

/** Top-level material definition. */
export interface MaterialDefinition {
  readonly name: string;
  readonly passes: readonly PassDefinition[];
  readonly version?: number;
}

/**
 * Build a complete Material from compiled shader data.
 *
 * Constructs the full Material → Pass → Variant → ShaderDefinition
 * hierarchy using the existing immutable data structures.
 */
export function buildMaterial(definition: MaterialDefinition): Material {
  const version = definition.version ?? LATEST_VERSION;

  const passes: readonly Pass[] = definition.passes.map(
    (passDef): Pass => {
      const shaderDefs: readonly ShaderDefinition[] = passDef.shaders.map(
        (cs): ShaderDefinition => ({
          stage: cs.stage,
          platform: cs.platform,
          inputs: cs.inputs,
          hash: 0n,
          bgfxShader: cs.bgfxShader,
        }),
      );

      const variant: Variant = {
        isSupported: true,
        flags: passDef.flags ?? {},
        shaders: shaderDefs,
      };

      return {
        name: passDef.name,
        supportedPlatforms: createSupportedPlatforms(),
        fallbackPass: "",
        defaultBlendMode: passDef.defaultBlendMode ?? BlendMode.Unspecified,
        defaultVariant: {},
        framebufferBinding: 0,
        variants: [variant],
      };
    },
  );

  return createMaterial({
    version,
    name: definition.name,
    encryption: EncryptionType.NONE,
    parent: "",
    passes,
  });
}
