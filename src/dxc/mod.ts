/**
 * DXC (DirectX Shader Compiler) FFI bindings for Bun.
 *
 * Compiles HLSL source code to DXIL bytecode in-memory using dxcompiler.dll.
 * Uses pure bun:ffi with COM vtable walking — no external build tools required.
 *
 * Windows x64 only (COM vtable calls rely on the unified Microsoft x64 ABI).
 */

import { dlopen, ptr, toArrayBuffer, type Library, type Pointer } from "bun:ffi";
import {
  CLSID_DxcCompiler,
  CLSID_DxcUtils,
  IID_IDxcBlob,
  IID_IDxcBlobUtf8,
  IID_IDxcCompiler3,
  IID_IDxcResult,
  IID_IDxcUtils,
  guidPtr,
} from "./guids.ts";
import { asPointer, callVtableMethod, comReleaseAll } from "./vtable.ts";
import {
  DxcOutKind,
  isHResultSuccess,
  formatHResult,
  type DxcCompileOptions,
  type DxcCompileResult,
} from "./types.ts";
import { buildWideStringArray } from "./wide-string.ts";
import { DxcCompilationError, DxcLoadError } from "./errors.ts";

export type { DxcCompileOptions, DxcCompileResult } from "./types.ts";
export { DxcOutKind, isHResultSuccess, formatHResult } from "./types.ts";
export { DxcError, DxcLoadError, DxcCompilationError } from "./errors.ts";

// ── DLL search ─────────────────────────────────────────────────────

const DXC_SEARCH_PATHS = [
  process.env["DXCOMPILER_PATH"],
  "dxcompiler.dll",
] as const;

function resolveDxcPath(explicitPath?: string): string {
  if (explicitPath) return explicitPath;

  for (const candidate of DXC_SEARCH_PATHS) {
    if (!candidate) continue;
    try {
      if (Bun.file(candidate).size > 0) return candidate;
    } catch {
      continue;
    }
  }

  // Fall through to bare name — dlopen will search system PATH
  return "dxcompiler.dll";
}

// ── DxcBuffer struct layout (24 bytes on x64) ─────────────────────

const DXC_BUFFER_SIZE = 24;
const DXC_BUFFER_OFFSET_PTR = 0;
const DXC_BUFFER_OFFSET_SIZE = 8;
const DXC_BUFFER_OFFSET_ENCODING = 16;

function buildDxcBuffer(
  sourcePtr: number,
  sourceSize: number,
  encoding: number,
): Uint8Array {
  const buf = new Uint8Array(DXC_BUFFER_SIZE);
  const view = new DataView(buf.buffer);
  view.setBigUint64(DXC_BUFFER_OFFSET_PTR, BigInt(sourcePtr), true);
  view.setBigUint64(DXC_BUFFER_OFFSET_SIZE, BigInt(sourceSize), true);
  view.setUint32(DXC_BUFFER_OFFSET_ENCODING, encoding, true);
  return buf;
}

// ── Build compiler argument list ──────────────────────────────────

function buildCompilerArgs(options: DxcCompileOptions): readonly string[] {
  const args: string[] = [
    "-T", options.targetProfile,
    "-E", options.entryPoint,
  ];

  if (options.defines) {
    for (const [key, value] of Object.entries(options.defines)) {
      args.push("-D", `${key}=${value}`);
    }
  }

  if (options.includePaths) {
    for (const dir of options.includePaths) {
      args.push("-I", dir);
    }
  }

  if (options.additionalArgs) {
    args.push(...options.additionalArgs);
  }

  return args;
}

// ── Read blob data as Uint8Array ──────────────────────────────────

function readBlobBytes(blobPtr: number): Uint8Array {
  const dataPtr = callVtableMethod(
    blobPtr, 3,
    { args: [], returns: "ptr" },
  ) as number;

  // GetBufferSize returns u64 (bigint) — convert to number for toArrayBuffer
  const sizeRaw = callVtableMethod(
    blobPtr, 4,
    { args: [], returns: "u64" },
  ) as bigint;
  const size = Number(sizeRaw);

  if (!dataPtr || size === 0) return new Uint8Array(0);

  // Copy the data out of COM-managed memory into a JS-owned buffer
  const arrayBuf = toArrayBuffer(asPointer(dataPtr), 0, size);
  return new Uint8Array(arrayBuf).slice();
}

// ── Read blob data as UTF-8 string ────────────────────────────────

const TEXT_DECODER = new TextDecoder("utf-8");

function readBlobUtf8(blobPtr: number): string {
  const bytes = readBlobBytes(blobPtr);
  return TEXT_DECODER.decode(bytes);
}

// ── DxcCompiler ───────────────────────────────────────────────────

/**
 * Wraps an IDxcCompiler3 COM instance for compiling HLSL to DXIL.
 *
 * Usage:
 * ```ts
 * const dxc = new DxcCompiler();
 * const result = dxc.compile({ source, entryPoint: "main", targetProfile: "ps_6_0" });
 * if (!result.success) throw new DxcCompilationError(result.errors);
 * // result.objectBytes contains compiled DXIL
 * dxc.dispose();
 * ```
 */
export class DxcCompiler {
  private readonly _compilerPtr: number;
  private readonly _utilsPtr: number;
  private readonly _includeHandlerPtr: number;
  private readonly _lib: Library<{
    DxcCreateInstance: {
      readonly args: readonly ["ptr", "ptr", "ptr"];
      readonly returns: "i32";
    };
  }>;
  private _disposed = false;

  constructor(dllPath?: string) {
    const resolvedPath = resolveDxcPath(dllPath);

    try {
      this._lib = dlopen(resolvedPath, {
        DxcCreateInstance: {
          args: ["ptr", "ptr", "ptr"],
          returns: "i32",
        },
      });
    } catch (err) {
      throw new DxcLoadError(resolvedPath, String(err));
    }

    // Create IDxcCompiler3
    const compilerOut = new BigUint64Array(1);
    const compilerHr = this._lib.symbols.DxcCreateInstance(
      guidPtr(CLSID_DxcCompiler),
      guidPtr(IID_IDxcCompiler3),
      ptr(compilerOut),
    ) as number;

    if (!isHResultSuccess(compilerHr)) {
      this._lib.close();
      throw new DxcLoadError(
        resolvedPath,
        `DxcCreateInstance(Compiler) failed: ${formatHResult(compilerHr)}`,
      );
    }

    this._compilerPtr = Number(compilerOut[0]);
    if (!this._compilerPtr) {
      this._lib.close();
      throw new DxcLoadError(resolvedPath, "DxcCreateInstance(Compiler) returned null");
    }

    // Create IDxcUtils for include handler support
    const utilsOut = new BigUint64Array(1);
    const utilsHr = this._lib.symbols.DxcCreateInstance(
      guidPtr(CLSID_DxcUtils),
      guidPtr(IID_IDxcUtils),
      ptr(utilsOut),
    ) as number;

    if (!isHResultSuccess(utilsHr)) {
      comReleaseAll([this._compilerPtr]);
      this._lib.close();
      throw new DxcLoadError(
        resolvedPath,
        `DxcCreateInstance(Utils) failed: ${formatHResult(utilsHr)}`,
      );
    }

    this._utilsPtr = Number(utilsOut[0]);

    // IDxcUtils::CreateDefaultIncludeHandler (vtable index 9)
    // HRESULT CreateDefaultIncludeHandler(IDxcIncludeHandler** ppResult)
    const handlerOut = new BigUint64Array(1);
    const handlerHr = callVtableMethod(
      this._utilsPtr, 9,
      { args: ["ptr"], returns: "i32" },
      ptr(handlerOut),
    ) as number;

    if (!isHResultSuccess(handlerHr)) {
      comReleaseAll([this._compilerPtr, this._utilsPtr]);
      this._lib.close();
      throw new DxcLoadError(
        resolvedPath,
        `CreateDefaultIncludeHandler failed: ${formatHResult(handlerHr)}`,
      );
    }

    this._includeHandlerPtr = Number(handlerOut[0]);
  }

  /**
   * Compile HLSL source code to DXIL bytecode.
   *
   * All data stays in-memory — source is passed as a buffer pointer to the
   * COM API, and compiled bytecode is copied out of COM-managed memory into
   * a JS-owned Uint8Array.
   */
  compile(options: DxcCompileOptions): DxcCompileResult {
    if (this._disposed) {
      throw new DxcCompilationError("DxcCompiler has been disposed");
    }

    // Build DxcBuffer pointing to the source bytes
    const dxcBuffer = buildDxcBuffer(
      ptr(options.source),
      options.source.byteLength,
      0, // DXC_CP_ACP — auto-detect, works for UTF-8
    );

    // Build wide-string argument array
    const argStrings = buildCompilerArgs(options);
    const { ptrArray: argPtrArray, buffers: _argBuffers } =
      buildWideStringArray(argStrings);

    // Allocate output pointer for IDxcResult
    const resultOutPtr = new BigUint64Array(1);

    // IDxcCompiler3::Compile (vtable index 3)
    // HRESULT Compile(
    //   const DxcBuffer* pSource,
    //   LPCWSTR* pArguments,
    //   UINT32 argCount,
    //   IDxcIncludeHandler* pIncludeHandler,
    //   REFIID riid,
    //   LPVOID* ppResult
    // )
    const compileHr = callVtableMethod(
      this._compilerPtr,
      3,
      { args: ["ptr", "ptr", "u32", "ptr", "ptr", "ptr"], returns: "i32" },
      ptr(dxcBuffer),
      ptr(argPtrArray),
      argStrings.length,
      this._includeHandlerPtr,
      guidPtr(IID_IDxcResult),
      ptr(resultOutPtr),
    ) as number;

    const resultPtr = Number(resultOutPtr[0]);
    if (!resultPtr) {
      return {
        success: false,
        objectBytes: new Uint8Array(0),
        errors: `Compile call failed with HRESULT ${formatHResult(compileHr)}, no result object`,
      };
    }

    // Track all COM objects for cleanup
    const comObjects: number[] = [resultPtr];

    try {
      return this._extractResult(resultPtr, comObjects);
    } finally {
      comReleaseAll(comObjects);
      // Keep references alive through the call to prevent GC
      void _argBuffers;
      void dxcBuffer;
      void argPtrArray;
      void options.source;
    }
  }

  private _extractResult(
    resultPtr: number,
    comObjects: number[],
  ): DxcCompileResult {
    // IDxcOperationResult::GetStatus (vtable index 3 on IDxcResult)
    // Note: IDxcResult inherits IDxcOperationResult which inherits IUnknown.
    // IDxcOperationResult adds: GetStatus(3), GetResult(4), GetErrorBuffer(5)
    // IDxcResult adds: HasOutput(6), GetOutput(7), GetNumOutputs(8), etc.
    const statusOut = new Int32Array(1);
    callVtableMethod(
      resultPtr, 3,
      { args: ["ptr"], returns: "i32" },
      ptr(statusOut),
    );
    const compilationStatus = statusOut[0]!;
    const success = isHResultSuccess(compilationStatus);

    // Extract error/warning messages
    let errors = "";
    const errorBlobOut = new BigUint64Array(1);
    const getErrorHr = callVtableMethod(
      resultPtr, 7,
      { args: ["i32", "ptr", "ptr", "ptr"], returns: "i32" },
      DxcOutKind.ERRORS,
      guidPtr(IID_IDxcBlobUtf8),
      ptr(errorBlobOut),
      0, // null output name
    ) as number;

    const errorBlobPtr = Number(errorBlobOut[0]);
    if (isHResultSuccess(getErrorHr) && errorBlobPtr) {
      comObjects.push(errorBlobPtr);
      errors = readBlobUtf8(errorBlobPtr);
    }

    if (!success) {
      return {
        success: false,
        objectBytes: new Uint8Array(0),
        errors,
      };
    }

    // Extract compiled object (DXIL bytecode)
    const objectBlobOut = new BigUint64Array(1);
    const getObjectHr = callVtableMethod(
      resultPtr, 7,
      { args: ["i32", "ptr", "ptr", "ptr"], returns: "i32" },
      DxcOutKind.OBJECT,
      guidPtr(IID_IDxcBlob),
      ptr(objectBlobOut),
      0, // null output name
    ) as number;

    const objectBlobPtr = Number(objectBlobOut[0]);
    if (!isHResultSuccess(getObjectHr) || !objectBlobPtr) {
      return {
        success: false,
        objectBytes: new Uint8Array(0),
        errors: errors || `GetOutput(OBJECT) failed: ${formatHResult(getObjectHr)}`,
      };
    }
    comObjects.push(objectBlobPtr);

    const objectBytes = readBlobBytes(objectBlobPtr);

    return { success: true, objectBytes, errors };
  }

  /** Release all underlying COM instances. */
  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    comReleaseAll([this._includeHandlerPtr, this._utilsPtr, this._compilerPtr]);
    this._lib.close();
  }
}

// ── Singleton access ──────────────────────────────────────────────

let _instance: DxcCompiler | null = null;

/** Get or create a singleton DxcCompiler instance. */
export function getDxcCompiler(dllPath?: string): DxcCompiler {
  if (_instance) return _instance;
  _instance = new DxcCompiler(dllPath);
  return _instance;
}

/** Dispose the singleton DxcCompiler instance. */
export function disposeDxcCompiler(): void {
  _instance?.dispose();
  _instance = null;
}

// ── Convenience function ──────────────────────────────────────────

/**
 * Compile HLSL source to DXIL bytecode. Throws on failure.
 *
 * Source stays entirely in-memory — never touches disk.
 */
export function compileHLSL(
  source: Uint8Array,
  options: Omit<DxcCompileOptions, "source">,
): Uint8Array {
  const compiler = getDxcCompiler();
  const result = compiler.compile({ ...options, source });
  if (!result.success) {
    throw new DxcCompilationError(result.errors);
  }
  return result.objectBytes;
}
