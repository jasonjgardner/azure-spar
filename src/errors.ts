export class MaterialError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MaterialError";
  }
}

export class MaterialFormatError extends MaterialError {
  constructor(message: string) {
    super(message);
    this.name = "MaterialFormatError";
  }
}

export class UnsupportedVersionError extends MaterialError {
  constructor(version: number) {
    super(`Unsupported material version: ${version}. Supported versions: 22-25.`);
    this.name = "UnsupportedVersionError";
  }
}

export class EncryptionError extends MaterialError {
  constructor(message: string) {
    super(message);
    this.name = "EncryptionError";
  }
}

export class DecompilerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecompilerError";
  }
}
