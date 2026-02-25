/** Options for compiling HLSL source via DXC. */
export interface DxcCompileOptions {
  /** HLSL source code as UTF-8 bytes. */
  readonly source: Uint8Array;
  /** Entry point function name (e.g., "main", "VSMain"). */
  readonly entryPoint: string;
  /** Target profile (e.g., "ps_6_0", "vs_6_0", "cs_6_0"). */
  readonly targetProfile: string;
  /** Additional DXC compiler arguments (e.g., ["-O3", "-Zi"]). */
  readonly additionalArgs?: readonly string[];
  /** Preprocessor define macros as key-value pairs. */
  readonly defines?: Readonly<Record<string, string>>;
  /** Include search directories for resolving #include directives. */
  readonly includePaths?: readonly string[];
}

/** Result of a DXC shader compilation. */
export interface DxcCompileResult {
  /** True if compilation succeeded (HRESULT S_OK). */
  readonly success: boolean;
  /** Compiled DXIL bytecode. Empty on failure. */
  readonly objectBytes: Uint8Array;
  /** Compiler error/warning messages. Empty string on clean success. */
  readonly errors: string;
}

/** DXC output kinds (DXC_OUT_KIND enum values). */
export const DxcOutKind = {
  NONE: 0,
  OBJECT: 1,
  ERRORS: 2,
  PDB: 3,
  SHADER_HASH: 4,
  DISASSEMBLY: 5,
  HLSL: 6,
  TEXT: 7,
  REFLECTION: 8,
  ROOT_SIGNATURE: 9,
  EXTRA_OUTPUTS: 10,
  REMARKS: 11,
  TIME_REPORT: 12,
  TIME_TRACE: 13,
} as const;

export type DxcOutKind = (typeof DxcOutKind)[keyof typeof DxcOutKind];

/** DXC code page constants. */
export const DxcCodePage = {
  UTF8: 65001,
  WIDE: 1200,
} as const;

/** HRESULT success check. */
export function isHResultSuccess(hr: number): boolean {
  return hr >= 0;
}

/** Format an HRESULT as a hex string for error messages. */
export function formatHResult(hr: number): string {
  return `0x${(hr >>> 0).toString(16).padStart(8, "0")}`;
}
