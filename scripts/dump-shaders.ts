#!/usr/bin/env bun
/**
 * Quick diagnostic: dump shader definitions from both azure-spar and lazurite output.
 */
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { readMaterial } from "../src/material/material.ts";

const ROOT = resolve(import.meta.dir, "..");

for (const label of ["vanilla", "azure-spar", "lazurite"]) {
  for (const mat of ["RTXStub", "RTXPostFX.Tonemapping", "RTXPostFX.Bloom"]) {
    const dir = label === "vanilla" ? "materials-backup" : `test-output/${label}`;
    const path = resolve(ROOT, dir, `${mat}.material.bin`);
    try {
      const data = readFileSync(path);
      const m = await readMaterial(new Uint8Array(data));
      console.log(`\n${label} | ${mat}:`);
      console.log(`  version=${m.version} passes=${m.passes.length} buffers=${m.buffers.length}`);

      // Show first 3 passes + last pass
      const indices = [0, 1, 2, m.passes.length - 1].filter(
        (v, i, a) => v >= 0 && v < m.passes.length && a.indexOf(v) === i,
      );

      for (const i of indices) {
        const p = m.passes[i]!;
        console.log(`  pass[${i}] "${p.name}" variants=${p.variants.length}`);
        for (let vi = 0; vi < Math.min(1, p.variants.length); vi++) {
          const v = p.variants[vi]!;
          console.log(`    v[${vi}] shaders=${v.shaders.length} supported=${v.isSupported}`);
          for (let si = 0; si < v.shaders.length; si++) {
            const s = v.shaders[si]!;
            console.log(
              `      s[${si}] stage=${s.stage} plat=${s.platform} ` +
                `hash=${s.hash} bgfx.hash=${s.bgfxShader.hash} ` +
                `bgfx.size=${s.bgfxShader.size} dxil=${s.bgfxShader.shaderBytes.length}B ` +
                `uniforms=${s.bgfxShader.uniforms.length} attrs=${s.bgfxShader.attributes.length} ` +
                `groupSize=[${s.bgfxShader.groupSize}]`,
            );
          }
        }
      }
    } catch (e: unknown) {
      console.log(`${label} | ${mat}: ERROR ${(e as Error).message}`);
    }
  }
}
