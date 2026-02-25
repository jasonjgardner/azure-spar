import { ptr } from "bun:ffi";

/**
 * Encode a JavaScript string as a null-terminated UTF-16LE buffer.
 * Suitable for passing as LPCWSTR to Windows COM APIs.
 */
export function toWideString(s: string): Uint8Array {
  const buf = new Uint8Array((s.length + 1) * 2);
  const view = new DataView(buf.buffer);
  for (let i = 0; i < s.length; i++) {
    view.setUint16(i * 2, s.charCodeAt(i), true);
  }
  return buf;
}

/**
 * Build an array of wide string pointers from an array of JS strings.
 *
 * Returns the pointer array (as Uint8Array of packed 64-bit pointers)
 * and the backing buffers (must be kept alive to prevent GC during the call).
 */
export function buildWideStringArray(strings: readonly string[]): {
  readonly ptrArray: Uint8Array;
  readonly buffers: readonly Uint8Array[];
} {
  const buffers = strings.map(toWideString);
  const ptrArray = new Uint8Array(strings.length * 8);
  const view = new DataView(ptrArray.buffer);
  for (let i = 0; i < buffers.length; i++) {
    view.setBigUint64(i * 8, BigInt(ptr(buffers[i]!)), true);
  }
  return { ptrArray, buffers };
}
