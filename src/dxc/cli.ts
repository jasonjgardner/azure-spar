/**
 * CLI-based DXC compiler for Linux/macOS.
 *
 * Invokes the `dxc` command-line tool via subprocess, using temp files
 * for source input and DXIL output. Provides the same interface as the
 * Windows FFI-based implementation.
 */

import { tmpdir } from "node:os";
import { join } from "node:path";
import { unlink, mkdir } from "node:fs/promises";
import type { DxcCompileOptions, DxcCompileResult } from "./types.ts";
import { DxcCompilationError, DxcLoadError } from "./errors.ts";

export type { DxcCompileOptions, DxcCompileResult };

// ── DXC executable search ─────────────────────────────────────────

const DXC_SEARCH_PATHS = [
  process.env["DXC_PATH"],
  "/opt/dxc/bin/dxc",
  "/usr/local/bin/dxc",
  "/usr/bin/dxc",
  "dxc",
] as const;

async function resolveDxcPath(explicitPath?: string): Promise<string> {
  if (explicitPath) return explicitPath;

  for (const candidate of DXC_SEARCH_PATHS) {
    if (!candidate) continue;
    try {
      const file = Bun.file(candidate);
      if (await file.exists()) return candidate;
    } catch {
      continue;
    }
  }

  // Fall through to bare name — shell will search PATH
  return "dxc";
}

// ── Build CLI arguments ───────────────────────────────────────────

function buildCliArgs(
  options: DxcCompileOptions,
  inputPath: string,
  outputPath: string,
): readonly string[] {
  const args: string[] = [
    "-T", options.targetProfile,
    "-E", options.entryPoint,
    "-Fo", outputPath,
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

  args.push(inputPath);

  return args;
}

// ── Temp file helpers ─────────────────────────────────────────────

const TEMP_DIR = join(tmpdir(), "azure-spar-dxc");
let tempDirCreated = false;

async function ensureTempDir(): Promise<void> {
  if (tempDirCreated) return;
  await mkdir(TEMP_DIR, { recursive: true });
  tempDirCreated = true;
}

function tempFilePath(suffix: string): string {
  const id = crypto.randomUUID().slice(0, 8);
  return join(TEMP_DIR, `dxc_${id}${suffix}`);
}

async function safeUnlink(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch {
    // Ignore — temp file may not exist on error paths
  }
}

// ── DxcCompilerCli ────────────────────────────────────────────────

/**
 * CLI-based DXC compiler for non-Windows platforms.
 *
 * Uses subprocess invocation with temp files. Thread-safe for concurrent
 * compiles since each call uses unique temp file names.
 */
export class DxcCompilerCli {
  private readonly _dxcPath: string;
  private _disposed = false;

  private constructor(dxcPath: string) {
    this._dxcPath = dxcPath;
  }

  static async create(dxcPath?: string): Promise<DxcCompilerCli> {
    const resolved = await resolveDxcPath(dxcPath);

    // Verify DXC is executable
    try {
      const proc = Bun.spawn([resolved, "--version"], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const exitCode = await proc.exited;
      if (exitCode !== 0) {
        throw new DxcLoadError(resolved, `dxc --version exited with code ${exitCode}`);
      }
    } catch (err) {
      if (err instanceof DxcLoadError) throw err;
      throw new DxcLoadError(resolved, `Failed to execute dxc: ${err}`);
    }

    return new DxcCompilerCli(resolved);
  }

  /**
   * Compile HLSL source code to DXIL bytecode via CLI.
   */
  async compile(options: DxcCompileOptions): Promise<DxcCompileResult> {
    if (this._disposed) {
      throw new DxcCompilationError("DxcCompilerCli has been disposed");
    }

    await ensureTempDir();

    const inputPath = tempFilePath(".hlsl");
    const outputPath = tempFilePath(".dxil");

    try {
      // Write source to temp file
      await Bun.write(inputPath, options.source);

      const args = buildCliArgs(options, inputPath, outputPath);

      const proc = Bun.spawn([this._dxcPath, ...args], {
        stdout: "pipe",
        stderr: "pipe",
      });

      const [exitCode, stderrBytes] = await Promise.all([
        proc.exited,
        new Response(proc.stderr).arrayBuffer(),
      ]);

      const stderr = new TextDecoder().decode(stderrBytes);

      if (exitCode !== 0) {
        return {
          success: false,
          objectBytes: new Uint8Array(0),
          errors: stderr || `dxc exited with code ${exitCode}`,
        };
      }

      // Read compiled output
      const outputFile = Bun.file(outputPath);
      if (!(await outputFile.exists())) {
        return {
          success: false,
          objectBytes: new Uint8Array(0),
          errors: stderr || "dxc did not produce output file",
        };
      }

      const objectBytes = new Uint8Array(await outputFile.arrayBuffer());

      return {
        success: true,
        objectBytes,
        errors: stderr, // May contain warnings
      };
    } finally {
      // Clean up temp files
      await Promise.all([safeUnlink(inputPath), safeUnlink(outputPath)]);
    }
  }

  dispose(): void {
    this._disposed = true;
  }
}

// ── Singleton access ──────────────────────────────────────────────

let _instance: DxcCompilerCli | null = null;

export async function getDxcCompilerCli(dxcPath?: string): Promise<DxcCompilerCli> {
  if (_instance) return _instance;
  _instance = await DxcCompilerCli.create(dxcPath);
  return _instance;
}

export function disposeDxcCompilerCli(): void {
  _instance?.dispose();
  _instance = null;
}

// ── Convenience function ──────────────────────────────────────────

/**
 * Compile HLSL source to DXIL bytecode via CLI. Throws on failure.
 */
export async function compileHLSLCli(
  source: Uint8Array,
  options: Omit<DxcCompileOptions, "source">,
): Promise<Uint8Array> {
  const compiler = await getDxcCompilerCli();
  const result = await compiler.compile({ ...options, source });
  if (!result.success) {
    throw new DxcCompilationError(result.errors);
  }
  return result.objectBytes;
}
