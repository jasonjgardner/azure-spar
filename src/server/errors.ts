/**
 * Server-specific error hierarchy.
 */

export class ServerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServerError";
  }
}

export class BuildTimeoutError extends ServerError {
  constructor(timeoutMs: number) {
    super(`Build timed out after ${timeoutMs}ms`);
    this.name = "BuildTimeoutError";
  }
}

export class BuildConcurrencyError extends ServerError {
  constructor(maxConcurrent: number) {
    super(
      `Maximum concurrent builds (${maxConcurrent}) exceeded. Try again later.`,
    );
    this.name = "BuildConcurrencyError";
  }
}

export class ShaderDataError extends ServerError {
  constructor(message: string) {
    super(`Failed to load shader data: ${message}`);
    this.name = "ShaderDataError";
  }
}

export class JobNotFoundError extends ServerError {
  constructor(id: string) {
    super(`Build job not found: ${id}`);
    this.name = "JobNotFoundError";
  }
}
