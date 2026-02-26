# Azure Spar

TypeScript rewrite of [lazurite](https://github.com/veka0/lazurite) — a shader development tool for Minecraft: Bedrock Edition with the RenderDragon graphics engine.

Azure Spar reads and writes `.material.bin` files, decompiles shader variants, and compiles custom HLSL shaders into replacement materials via DXC. It includes a full compilation pipeline for [BetterRTX](https://github.com/BetterRTX), a ray tracing shader pack for Minecraft RTX.

## Requirements

- [Bun](https://bun.sh) runtime
- Windows x64 (DXC FFI requires `dxcompiler.dll`)
- `dxcompiler.dll` and `dxil.dll` (from [DirectX Shader Compiler](https://github.com/microsoft/DirectXShaderCompiler/releases))

## Getting Started

```sh
# Install dev dependencies
bun install

# First-time setup: extract shaders from archive, backup base materials, generate manifest
bun run scripts/setup.ts --materials "path/to/minecraft/materials" --archive shader_source.tar.gz

# Compile materials (dev mode — reads shaders from disk)
bun run src/main.ts --output ./output --settings user-settings.json

# Type check
bunx tsc --noEmit
```

### Building a Standalone Executable

```sh
bun build --compile src/main.ts --outfile brtxbuilder \
  ./shaders/**/*.hlsl ./shaders/**/*.hlsli ./shaders/**/*.h \
  ./shaders/manifest.json ./shaders/register-bindings.json
```

This produces `brtxbuilder.exe` with all shader sources embedded via `Bun.embeddedFiles`.

## Architecture

### Module Overview

| Module | Path | Purpose |
|--------|------|---------|
| **Material** | `src/material/` | Core `.material.bin` binary format: read, write, create, serialize. Ported from lazurite. |
| **Binary** | `src/binary/` | Immutable offset-based `BinaryReader` and `BinaryWriter`. |
| **Decompiler** | `src/decompiler/` | Restore HLSL source from compiled shader variants via flag permutation analysis. |
| **DXC** | `src/dxc/` | Pure `bun:ffi` COM vtable walking to call `dxcompiler.dll` in-process. |
| **BetterRTX** | `src/betterrtx/` | Shader source loading, manifest/config parsing, register binding extraction, user settings. |
| **Compiler** | `src/compiler/` | Full pipeline orchestrator: HLSL → DXC → BgfxShader → Material → `.material.bin`. |

### Compilation Pipeline

```
Embedded HLSL → DXC compile → DXIL bytecode → BgfxShader wrap → Material build → .material.bin
```

All shader source stays in-memory — never touches disk during compilation.

### Dependency Flow

```
src/main.ts (CLI entry)
    ↓
src/compiler/mod.ts (orchestrator)
    ↓                    ↓                   ↓
src/dxc/mod.ts      src/betterrtx/mod.ts   src/material/mod.ts
(HLSL→DXIL)         (shader loading)        (material I/O)
                                                ↓
                                           src/binary/ (reader/writer)
```

### Dual-Mode Shader Loading

- **Dev mode** (`bun run src/main.ts`): reads from `shaders/` directory on disk (populated by `scripts/setup.ts`)
- **Compiled mode** (`./brtxbuilder.exe`): reads from `Bun.embeddedFiles` baked into the executable

## Usage as a Library

```typescript
import { readMaterial, writeMaterial, createMaterial } from "azure-spar/material"
import { compileMaterial } from "azure-spar/compiler"
import { getDxcCompiler, compileHLSL } from "azure-spar/dxc"
import { loadManifests, loadSettingsFile } from "azure-spar/betterrtx"
```

### Package Exports

| Export | Entry Point | Description |
|--------|-------------|-------------|
| `azure-spar` | `src/mod.ts` | Full public API |
| `azure-spar/material` | `src/material/mod.ts` | Material binary format |
| `azure-spar/compiler` | `src/compiler/mod.ts` | Compilation pipeline |
| `azure-spar/betterrtx` | `src/betterrtx/mod.ts` | Shader loading & config |
| `azure-spar/dxc` | `src/dxc/mod.ts` | DXC compiler FFI |

### Reading a Material

```typescript
import { readMaterial } from "azure-spar/material"

const data = await Bun.file("RTXStub.material.bin").bytes()
const material = readMaterial(data)

console.log(material.name)    // "RTXStub"
console.log(material.version) // 25
console.log(material.passes)  // Pass[]
```

### Compiling a Material

```typescript
import { compileMaterial } from "azure-spar/compiler"
import { loadManifests, loadRegisterBindings } from "azure-spar/betterrtx"

const manifests = await loadManifests()
const registerBindings = await loadRegisterBindings()

for (const manifest of manifests) {
  const result = await compileMaterial(manifest, {
    registerDefines: registerBindings[manifest.materialName] ?? {},
    userDefines: { TONEMAPPING_TYPE: "1", ENABLE_DOF: "1" },
  })

  await Bun.write(`output/${manifest.materialName}.material.bin`, result.binary)
}
```

## User Settings

Shader behavior can be customized via a JSON settings file. Values become DXC preprocessor defines (`-D`):

```json
{
  "TONEMAPPING_TYPE": 1,
  "ENABLE_DOF": true,
  "DOF_APERTURE_SIZE": 0.012,
  "WATER_PARALLAX_AMPLITUDE": 0.2,
  "$comment": "Keys starting with $ are treated as metadata and ignored"
}
```

## Target Materials

| Material | Type | Shader Model | Register Bindings |
|----------|------|-------------|-------------------|
| RTXStub | Compute | SM 6.5 | 0 |
| RTXPostFX.Tonemapping | Fragment | SM 6.5 | 4 |
| RTXPostFX.Bloom | Fragment | SM 6.5 | 2 |

### Define Priority (lowest → highest)

1. User settings (from `--settings` JSON file)
2. Register bindings (from base material extraction)
3. Per-shader pass defines (from manifest)

## Documentation

- [Material format](docs/material.md) — `.material.bin` binary format schema
- [Shader platforms](docs/platforms.md) — Supported RenderDragon shader platforms
- [Supported versions](docs/supported_versions.md) — Format versions and Minecraft releases

## License

[LGPL-3.0](LICENSE)

## Acknowledgments

- [lazurite](https://github.com/veka0/lazurite) by veka0 — the original Python tool this project is based on
- [DirectX Shader Compiler](https://github.com/microsoft/DirectXShaderCompiler) — HLSL to DXIL compilation
- [BetterRTX](https://github.com/BetterRTX) — ray tracing shader pack for Minecraft RTX
