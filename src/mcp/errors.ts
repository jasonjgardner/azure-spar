/**
 * MCP-specific error class.
 *
 * Used for errors originating in MCP tool/resource handlers
 * that should be reported back to the AI client.
 */

export class McpError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpError";
  }
}
