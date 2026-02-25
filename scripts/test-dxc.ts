#!/usr/bin/env bun
/**
 * Smoke test for DXC FFI — compiles real BetterRTX shaders with register bindings.
 * Run after setup.ts has extracted shaders and backed up materials.
 */

import { resolve } from "node:path";
import { DxcCompiler } from "../src/dxc/mod.ts";

const SHADERS_DIR = resolve(import.meta.dir, "../shaders");
const dxc = new DxcCompiler("./dxcompiler.dll");

let passed = 0;
let failed = 0;

function report(success: boolean, detail: string): void {
  if (success) {
    passed++;
    console.log(`  PASS: ${detail}`);
  } else {
    failed++;
    console.log(`  FAIL: ${detail}`);
  }
}

// Load register bindings from setup output
let registerBindings: Record<string, Record<string, string>> = {};
try {
  registerBindings = await Bun.file(
    resolve(SHADERS_DIR, "register-bindings.json"),
  ).json();
} catch {
  console.log("Warning: No register-bindings.json found. Run setup.ts first.\n");
}

// ── Test 1: Trivial shader ──────────────────────────────────────
console.log("=== Test 1: Trivial pixel shader ===");
const trivial = new TextEncoder().encode(
  "float4 main() : SV_Target { return float4(1,0,0,1); }",
);
const r1 = dxc.compile({
  source: trivial,
  entryPoint: "main",
  targetProfile: "ps_6_0",
});
report(r1.success && r1.objectBytes.length > 0,
  `Success=${r1.success}, DXIL=${r1.objectBytes.length} bytes`);

// ── Test 2: Compute shader SM 6.5 ──────────────────────────────
console.log("\n=== Test 2: Compute shader SM 6.5 ===");
const cs = new TextEncoder().encode(`
[numthreads(8, 8, 1)]
void main(uint3 DTid : SV_DispatchThreadID) {}
`);
const r2 = dxc.compile({
  source: cs,
  entryPoint: "main",
  targetProfile: "cs_6_5",
  additionalArgs: ["-enable-16bit-types"],
});
report(r2.success && r2.objectBytes.length > 0,
  `Success=${r2.success}, DXIL=${r2.objectBytes.length} bytes`);

// ── Test 3: Error case ──────────────────────────────────────────
console.log("\n=== Test 3: Error handling ===");
const bad = new TextEncoder().encode("this is not valid hlsl");
const r3 = dxc.compile({
  source: bad,
  entryPoint: "main",
  targetProfile: "ps_6_0",
});
report(!r3.success && r3.errors.length > 0,
  `Success=${r3.success}, Error: ${r3.errors.split("\n")[0]}`);

// ── Test 4: BloomUpscalePass with register bindings ─────────────
console.log("\n=== Test 4: BetterRTX BloomUpscalePass (with registers) ===");
try {
  const bloomSource = await Bun.file(
    `${SHADERS_DIR}/RTXPostFX.Bloom/shaders/BloomUpscalePass.Fragment.hlsl`,
  ).bytes();
  console.log(`  Source: ${bloomSource.length} bytes`);

  const bloomRegs = registerBindings["RTXPostFX.Bloom"] ?? {};
  console.log(`  Register defines: ${JSON.stringify(bloomRegs)}`);

  const r4 = dxc.compile({
    source: new Uint8Array(bloomSource),
    entryPoint: "main",
    targetProfile: "ps_6_5",
    additionalArgs: ["-Qstrip_reflect"],
    defines: {
      ...bloomRegs,
      __PASS_BLOOMUPSCALEPASS__: "1",
    },
    includePaths: [`${SHADERS_DIR}/RTXPostFX.Bloom/shaders`],
  });
  report(r4.success,
    `Success=${r4.success}, DXIL=${r4.objectBytes.length} bytes`);
  if (r4.errors) {
    console.log(`  Diagnostics: ${r4.errors.slice(0, 500)}`);
  }
} catch (e) {
  failed++;
  console.log(`  SKIP: ${e}`);
}

// ── Test 5: ToneMapping with register bindings ──────────────────
console.log("\n=== Test 5: BetterRTX ToneMapping (with registers) ===");
try {
  const tmSource = await Bun.file(
    `${SHADERS_DIR}/RTXPostFX.Tonemapping/shaders/ToneMapping.Fragment.hlsl`,
  ).bytes();
  console.log(`  Source: ${tmSource.length} bytes`);

  const tmRegs = registerBindings["RTXPostFX.Tonemapping"] ?? {};
  console.log(`  Register defines: ${JSON.stringify(tmRegs)}`);

  const r5 = dxc.compile({
    source: new Uint8Array(tmSource),
    entryPoint: "main",
    targetProfile: "ps_6_5",
    additionalArgs: ["-Qstrip_reflect"],
    defines: {
      ...tmRegs,
      __PASS_TONEMAPPING__: "1",
    },
    includePaths: [`${SHADERS_DIR}/RTXPostFX.Tonemapping/shaders`],
  });
  report(r5.success,
    `Success=${r5.success}, DXIL=${r5.objectBytes.length} bytes`);
  if (r5.errors) {
    console.log(`  Diagnostics: ${r5.errors.slice(0, 500)}`);
  }
} catch (e) {
  failed++;
  console.log(`  SKIP: ${e}`);
}

// ── Test 6: BloomDownscaleGaussian ───────────────────────────────
console.log("\n=== Test 6: BetterRTX BloomDownscaleGaussian (with registers) ===");
try {
  const gaussSource = await Bun.file(
    `${SHADERS_DIR}/RTXPostFX.Bloom/shaders/BloomDownscaleGaussianPass.Fragment.hlsl`,
  ).bytes();
  console.log(`  Source: ${gaussSource.length} bytes`);

  const bloomRegs = registerBindings["RTXPostFX.Bloom"] ?? {};

  const r6 = dxc.compile({
    source: new Uint8Array(gaussSource),
    entryPoint: "main",
    targetProfile: "ps_6_5",
    additionalArgs: ["-Qstrip_reflect"],
    defines: {
      ...bloomRegs,
      __PASS_BLOOMDOWNSCALEGAUSSIANPASS__: "1",
    },
    includePaths: [`${SHADERS_DIR}/RTXPostFX.Bloom/shaders`],
  });
  report(r6.success,
    `Success=${r6.success}, DXIL=${r6.objectBytes.length} bytes`);
  if (r6.errors) {
    console.log(`  Diagnostics: ${r6.errors.slice(0, 500)}`);
  }
} catch (e) {
  failed++;
  console.log(`  SKIP: ${e}`);
}

// ── Test 7–11: RTXStub compute shaders (no register defines needed) ─
const RTXSTUB_INCLUDE = `${SHADERS_DIR}/RTXStub/shaders`;
const rtxStubArgs = ["-enable-16bit-types", "-Qstrip_reflect", "-DDXR_1_1", "-no-warnings"];

const rtxStubTests = [
  { name: "RayGen (PrimaryCheckerboard)", file: "RayGen.hlsl", entry: "PrimaryCheckerboardRayGenInline", pass: "PRIMARYCHECKERBOARDRAYGENINLINE" },
  { name: "FinalCombine", file: "FinalCombine.hlsl", entry: "FinalCombine", pass: "FINALCOMBINE" },
  { name: "Denoising (Atrous)", file: "Denoising.hlsl", entry: "AtrousColour", pass: "ATROUS" },
  { name: "VolumetricLighting", file: "VolumetricLighting.hlsl", entry: "CalculateInscatterInline", pass: "CALCULATEINSCATTERINLINE" },
  { name: "PathTracing RayGen", file: "RayGen.hlsl", entry: "PathTracingRayGenInline", pass: "PATHTRACINGRRAYGENINLINE" },
] as const;

for (let i = 0; i < rtxStubTests.length; i++) {
  const t = rtxStubTests[i]!;
  console.log(`\n=== Test ${7 + i}: RTXStub ${t.name} (compute) ===`);
  try {
    const source = await Bun.file(`${SHADERS_DIR}/RTXStub/shaders/${t.file}`).bytes();
    console.log(`  Source: ${source.length} bytes`);

    const result = dxc.compile({
      source: new Uint8Array(source),
      entryPoint: t.entry,
      targetProfile: "cs_6_5",
      additionalArgs: rtxStubArgs,
      defines: { [`__PASS_${t.pass}__`]: "1" },
      includePaths: [RTXSTUB_INCLUDE],
    });
    report(result.success && result.objectBytes.length > 0,
      `Success=${result.success}, DXIL=${result.objectBytes.length} bytes`);
    if (result.errors) {
      console.log(`  Diagnostics: ${result.errors.slice(0, 500)}`);
    }
  } catch (e) {
    failed++;
    console.log(`  SKIP: ${e}`);
  }
}

dxc.dispose();
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
