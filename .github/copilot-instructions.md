# Azure-Spar — Copilot Instructions

## What This Is

TypeScript rewrite of [lazurite](https://github.com/veka0/lazurite) for Minecraft Bedrock's RenderDragon `.material.bin` format. Compiles BetterRTX HLSL shaders via DXC into replacement materials. **Zero runtime dependencies** — only `@types/bun` + `typescript` as dev deps.

## Runtime & Commands

Always use **Bun** (`bun` / `bunx`), never `npm` / `npx`. No build step for library usage — Bun runs `.ts` directly.

```sh
bunx tsc --noEmit                    # Type check (strict + noUncheckedIndexedAccess)
bun run src/main.ts --output ./out   # Dev-mode compile (reads shaders/ from disk)
bun run scripts/test-dxc.ts          # DXC FFI smoke test
bun run scripts/setup.ts --materials "path" --archive archive.tar.gz  # First-time setup
```

## Architecture — Module Flow

```
src/main.ts (CLI)  →  src/compiler/mod.ts (orchestrator)
                        ├── src/dxc/mod.ts          (HLSL → DXIL via bun:ffi COM vtable walking)
                        ├── src/betterrtx/mod.ts    (shader loading, manifest/config, settings)
                        └── src/material/mod.ts     (read/write .material.bin)
                              └── src/binary/       (BinaryReader / BinaryWriter)
```

Pipeline: `Embedded HLSL → DXC compile → DXIL bytecode → BgfxShader wrap → Material build → .material.bin`

## Critical Conventions

### Immutability — All Data Structures Are `readonly`

Every interface uses `readonly` properties, `readonly T[]`, `Readonly<Record<K,V>>`, and `ReadonlyMap`. **Never mutate** — always spread to create new objects:

```typescript
// ✅ Correct
function updateMaterial(m: Material, name: string): Material {
  return { ...m, name };
}

// ❌ Wrong — mutation
function updateMaterial(m: Material, name: string): Material {
  m.name = name; return m;
}
```

### Factory Functions

`createMaterial()` accepts `Partial<Material>` with spread defaults. Leaf factories (`createBgfxShader()`, `createShaderDefinition()`) take no args and return zero-value defaults.

### Module Barrel Pattern

Each module has a `mod.ts` barrel export. The root `src/mod.ts` re-exports from module barrels (not leaf files). Types must use `export type { ... }` due to `verbatimModuleSyntax: true`. Section headers use box-drawing comments: `// ── Section ─────...`

### Per-Module Error Hierarchy

Each domain has its own base error extending `Error` directly — there is no shared uber-base:
- `MaterialError` → `MaterialFormatError`, `UnsupportedVersionError`, `EncryptionError`
- `DxcError` → `DxcLoadError`, `DxcCompilationError` (carries `readonly diagnostics: string`)
- `SettingsError`, `DecompilerError`

## DXC FFI — Key Gotchas

The DXC bindings in `src/dxc/` use pure `bun:ffi` COM vtable walking (no N-API, no C compiler):
- `Pointer` is a branded type — use `asPointer()` to cast `number → Pointer`
- `CFunction()` is a function call, **not** `new CFunction()`
- `IDxcBlob::GetBufferSize` returns `u64` (bigint) — must `Number()` before use
- String args are UTF-16LE via `src/dxc/wide-string.ts`
- Singleton: `getDxcCompiler()` / `disposeDxcCompiler()` — always dispose when done
- `bun:ffi cc` is broken on Windows (Bun issue #14545) — do not use it

## Define Priority (lowest → highest)

`User settings → Register bindings → Per-shader pass defines`

Register bindings (`s_<BufferName>_REG`) are extracted from vanilla `.material.bin` files during setup and stored in `shaders/register-bindings.json`.

## Dual-Mode Shader Loading

- **Dev mode** (`bun run src/main.ts`): reads from `shaders/` directory on disk
- **Compiled mode** (`bun build --compile`): reads from `Bun.embeddedFiles` baked into exe

## Binary Reader/Writer

`src/binary/` provides `BinaryReader` (immutable offset-advancing) and `BinaryWriter` (auto-growing buffer). All little-endian. Strings/arrays are length-prefixed with a `u32` header. `readX()` and `writeX()` methods come in symmetric pairs.

## Package Exports

```
azure-spar            → src/mod.ts          (full public API)
azure-spar/material   → src/material/mod.ts
azure-spar/compiler   → src/compiler/mod.ts
azure-spar/betterrtx  → src/betterrtx/mod.ts
azure-spar/dxc        → src/dxc/mod.ts
```

## Target Materials

`RTXStub`, `RTXPostFX.Tonemapping`, `RTXPostFX.Bloom` — these are the only materials compiled in the BetterRTX pipeline.
