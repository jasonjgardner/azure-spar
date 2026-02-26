import { readMaterial, writeMaterial } from "./src/material/material.ts";
import { SHADER_PLATFORM_NAMES, SHADER_STAGE_NAMES } from "./src/material/enums.ts";
import { serializeMaterialProperties, serializeMinimal } from "./src/material/serialization.ts";

const filePath = process.argv[2] ?? "C:/XboxGames/Minecraft for Windows/Content/data/renderer/materials/RTXStub.material.bin";

console.log(`Reading: ${filePath}\n`);

const fileData = await Bun.file(filePath).arrayBuffer();
const data = new Uint8Array(fileData);

console.log(`File size: ${data.byteLength} bytes\n`);

// Read material
const material = await readMaterial(data);

// Print basic properties
console.log("=== Material Properties ===");
console.log(`Version: ${material.version}`);
console.log(`Name: ${material.name}`);
console.log(`Encryption: ${material.encryption}`);
console.log(`Parent: ${material.parent || "(none)"}`);
console.log(`Buffers: ${material.buffers.length}`);
console.log(`Uniforms: ${material.uniforms.length}`);
console.log(`Uniform Overrides: ${Object.keys(material.uniformOverrides).length}`);
console.log(`Passes: ${material.passes.length}`);

// Print buffer names
if (material.buffers.length > 0) {
  console.log("\n--- Buffers ---");
  for (const buf of material.buffers) {
    console.log(`  ${buf.name}`);
  }
}

// Print uniform names
if (material.uniforms.length > 0) {
  console.log("\n--- Uniforms ---");
  for (const u of material.uniforms) {
    console.log(`  ${u.name} (${u.type})`);
  }
}

// Print passes
console.log("\n--- Passes ---");
for (const pass of material.passes) {
  console.log(`  ${pass.name}:`);
  console.log(`    Variants: ${pass.variants.length}`);
  for (const variant of pass.variants) {
    const platforms = new Set(variant.shaders.map(s => SHADER_PLATFORM_NAMES[s.platform]));
    const stages = new Set(variant.shaders.map(s => SHADER_STAGE_NAMES[s.stage]));
    console.log(`    - Flags: ${JSON.stringify(variant.flags)}`);
    console.log(`      Shaders: ${variant.shaders.length} (platforms: ${[...platforms].join(", ")}, stages: ${[...stages].join(", ")})`);
  }
}

// Test round-trip: write and re-read
console.log("\n=== Round-Trip Test ===");
const written = await writeMaterial(material);
console.log(`Written size: ${written.byteLength} bytes`);

const reread = await readMaterial(written);
console.log(`Re-read name: ${reread.name}`);
console.log(`Re-read version: ${reread.version}`);
console.log(`Re-read passes: ${reread.passes.length}`);

// Compare byte-for-byte
if (data.byteLength === written.byteLength) {
  let match = true;
  for (let i = 0; i < data.byteLength; i++) {
    if (data[i] !== written[i]) {
      console.log(`MISMATCH at byte ${i}: original=${data[i]}, written=${written[i]}`);
      match = false;
      break;
    }
  }
  if (match) {
    console.log("PASS: Byte-for-byte round-trip match!");
  }
} else {
  console.log(`SIZE MISMATCH: original=${data.byteLength}, written=${written.byteLength}`);
}

// Test serialization
console.log("\n=== Serialization Test ===");
const props = serializeMaterialProperties(material);
console.log("Properties:", JSON.stringify(props, null, 2));

const minimal = serializeMinimal(material);
console.log(`Minimal JSON array length: ${minimal.length}`);
console.log("Minimal format version:", minimal[0]);
