export class DxcError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DxcError";
  }
}

export class DxcLoadError extends DxcError {
  constructor(dllPath: string, reason: string) {
    super(`Failed to load dxcompiler.dll from "${dllPath}": ${reason}`);
    this.name = "DxcLoadError";
  }
}

export class DxcCompilationError extends DxcError {
  readonly diagnostics: string;

  constructor(diagnostics: string) {
    super(`HLSL compilation failed:\n${diagnostics}`);
    this.name = "DxcCompilationError";
    this.diagnostics = diagnostics;
  }
}
