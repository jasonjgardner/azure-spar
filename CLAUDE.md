# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

Azure-spar is a TypeScript rewrite of the Python [lazurite](https://github.com/veka0/lazurite) tool for Minecraft Bedrock Edition's RenderDragon shader materials. It reads/writes `.material.bin` files, decompiles shader variants, and compiles custom HLSL shaders via DXC into replacement materials — specifically for the [BetterRTX](https://github.com/BetterRTX) ray tracing shader pack.

## Runtime & Build

- **Runtime**: Bun (always use `bun` / `bunx`, never `npm` / `npx`)
- **Type check**: `bunx tsc --noEmit`
- **No build step** for library usage — Bun runs `.ts` files directly
- **Compile to standalone exe**: `bun build --compile src/main.ts --outfile brtxbuilder ./shaders/**/*.hlsl ./shaders/**/*.hlsli ./shaders/**/*.h ./shaders/manifest.json ./shaders/register-bindings.json`
- **Zero runtime dependencies** — only `@types/bun` and `typescript` as dev/peer deps

## Key Commands

```sh
# First-time setup: extract shaders from archive, backup base materials, generate manifest
bun run scripts/setup.ts --materials "path/to/minecraft/materials" --archive shader_source.tar.gz

# Run the compiler CLI (dev mode — reads shaders from disk)
bun run src/main.ts --output ./output --settings user-settings.json

# Smoke test DXC FFI bindings (requires dxcompiler.dll + shaders extracted)
bun run scripts/test-dxc.ts

# Type check
bunx tsc --noEmit
```

## Architecture

### Module Dependency Flow

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

### Compilation Pipeline

`Embedded HLSL → DXC compile → DXIL bytecode → BgfxShader wrap → Material build → .material.bin`

All shader source stays in-memory — never touches disk during compilation.

### Module Responsibilities

- **`src/material/`** — Core material binary format: read/write `.material.bin`, all data structures (`Material`, `Pass`, `Variant`, `ShaderDefinition`, `BgfxShader`), enums, and JSON serialization. Ported from lazurite.
- **`src/binary/`** — Immutable offset-based `BinaryReader` and `BinaryWriter` for the material binary format.
- **`src/decompiler/`** — Restores HLSL source from compiled shader variants by analyzing flag permutations and diffing.
- **`src/dxc/`** — Pure `bun:ffi` COM vtable walking to call `dxcompiler.dll` in-process. Windows x64 only.
- **`src/betterrtx/`** — Shader source loading (from `Bun.embeddedFiles` in compiled mode, filesystem in dev), manifest/config parsing, register binding extraction, user settings → DXC defines.
- **`src/compiler/`** — Orchestrates the full pipeline: loads manifests, compiles each shader via DXC, wraps DXIL as BgfxShader, builds Material, serializes to binary.

### Dual-Mode Shader Loading

Shaders load differently depending on context:
- **Dev mode** (`bun run src/main.ts`): reads from `shaders/` directory on disk (populated by `scripts/setup.ts`)
- **Compiled mode** (`bun build --compile`): reads from `Bun.embeddedFiles` baked into the executable

### DXC FFI Specifics

The DXC bindings use pure `bun:ffi` with COM vtable walking — no C compiler or N-API needed:
- `Pointer` is a branded type in Bun — use `asPointer()` to cast `number → Pointer`
- `CFunction()` is a function call, NOT `new CFunction()`
- `IDxcBlob::GetBufferSize` returns `u64` (bigint) — must `Number()` before use
- String arguments to DXC are UTF-16LE wide strings built in `wide-string.ts`
- `DxcCompiler` is used as a singleton via `getDxcCompiler()` / `disposeDxcCompiler()`
- `bun:ffi cc` is broken on Windows (Bun issue #14545) — do not attempt to use it

### Register Bindings

BetterRTX shaders need register slot defines (`s_<BufferName>_REG`) extracted from the base game's `.material.bin` files. These are extracted during `scripts/setup.ts` and stored in `shaders/register-bindings.json`. RTXStub (compute) has 0 register bindings; RTXPostFX materials have 2-4 each.

### Define Priority (lowest → highest)

User settings → Register bindings → Per-shader pass defines

### Package Exports

```json
{
  ".": "./src/mod.ts",
  "./compiler": "./src/compiler/mod.ts",
  "./betterrtx": "./src/betterrtx/mod.ts",
  "./material": "./src/material/mod.ts",
  "./dxc": "./src/dxc/mod.ts"
}
```

## Conventions

- All data structures use `readonly` properties (immutable)
- Factory functions like `createMaterial()` accept `Partial<T>`
- Error classes extend per-module base errors (`MaterialError`, `DxcError`, `SettingsError`, `DecompilerError`)
- Each module has a `mod.ts` barrel export
- `tsconfig.json` uses `strict: true`, `noUncheckedIndexedAccess: true`, `verbatimModuleSyntax: true`
- Target materials: `RTXStub`, `RTXPostFX.Tonemapping`, `RTXPostFX.Bloom`

## CI

GitHub Actions workflow (`.github/workflows/build.yml`) runs on `workflow_dispatch` with form inputs for shader settings. It downloads a pre-built `brtxbuilder.exe` (URL in secrets), DXC binaries, generates a `user-settings.json` from form inputs, compiles materials, and uploads artifacts.
