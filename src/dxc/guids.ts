import { ptr, type Pointer } from "bun:ffi";

/**
 * Encode a COM GUID as a 16-byte Uint8Array in standard binary layout:
 * - Data1 (4 bytes, little-endian)
 * - Data2 (2 bytes, little-endian)
 * - Data3 (2 bytes, little-endian)
 * - Data4 (8 bytes, big-endian / raw order)
 */
export function guidFromParts(
  data1: number,
  data2: number,
  data3: number,
  data4: readonly number[],
): Uint8Array {
  const buf = new Uint8Array(16);
  const view = new DataView(buf.buffer);
  view.setUint32(0, data1, true);
  view.setUint16(4, data2, true);
  view.setUint16(6, data3, true);
  for (let i = 0; i < 8; i++) {
    buf[8 + i] = data4[i]!;
  }
  return buf;
}

/** Returns a stable pointer to a GUID buffer for passing to COM APIs. */
export function guidPtr(guid: Uint8Array): Pointer {
  return ptr(guid);
}

// ── Class IDs ──────────────────────────────────────────────────────

/** CLSID_DxcCompiler: {73e22d93-e6ce-47f3-b5bf-f0664f39c1b0} */
export const CLSID_DxcCompiler = guidFromParts(
  0x73e22d93, 0xe6ce, 0x47f3,
  [0xb5, 0xbf, 0xf0, 0x66, 0x4f, 0x39, 0xc1, 0xb0],
);

/** CLSID_DxcUtils (same as CLSID_DxcLibrary): {6245d6af-66e0-48fd-80b4-4d271796748c} */
export const CLSID_DxcUtils = guidFromParts(
  0x6245d6af, 0x66e0, 0x48fd,
  [0x80, 0xb4, 0x4d, 0x27, 0x17, 0x96, 0x74, 0x8c],
);

// ── Interface IDs ──────────────────────────────────────────────────

/** IID_IDxcCompiler3: {228B4687-5A6A-4730-900C-9702B2203F54} */
export const IID_IDxcCompiler3 = guidFromParts(
  0x228b4687, 0x5a6a, 0x4730,
  [0x90, 0x0c, 0x97, 0x02, 0xb2, 0x20, 0x3f, 0x54],
);

/** IID_IDxcUtils: {4605C4CB-2019-492A-ADA4-65F20BB7D67F} */
export const IID_IDxcUtils = guidFromParts(
  0x4605c4cb, 0x2019, 0x492a,
  [0xad, 0xa4, 0x65, 0xf2, 0x0b, 0xb7, 0xd6, 0x7f],
);

/** IID_IDxcResult: {58346CDA-DDE7-4497-9461-6F87AF5E0659} */
export const IID_IDxcResult = guidFromParts(
  0x58346cda, 0xdde7, 0x4497,
  [0x94, 0x61, 0x6f, 0x87, 0xaf, 0x5e, 0x06, 0x59],
);

/** IID_IDxcBlob: {8BA5FB08-5195-40e2-AC58-0D989C3A0102} */
export const IID_IDxcBlob = guidFromParts(
  0x8ba5fb08, 0x5195, 0x40e2,
  [0xac, 0x58, 0x0d, 0x98, 0x9c, 0x3a, 0x01, 0x02],
);

/** IID_IDxcBlobUtf8: {3DA636C9-BA71-4024-A301-30CBF125305B} */
export const IID_IDxcBlobUtf8 = guidFromParts(
  0x3da636c9, 0xba71, 0x4024,
  [0xa3, 0x01, 0x30, 0xcb, 0xf1, 0x25, 0x30, 0x5b],
);

/** IID_IDxcBlobEncoding: {7241d424-2646-4191-97c0-98e96e42fc68} */
export const IID_IDxcBlobEncoding = guidFromParts(
  0x7241d424, 0x2646, 0x4191,
  [0x97, 0xc0, 0x98, 0xe9, 0x6e, 0x42, 0xfc, 0x68],
);

/** IID_IDxcOperationResult: {CEDB484A-D4E9-445A-B991-CA21CA157DC2} */
export const IID_IDxcOperationResult = guidFromParts(
  0xcedb484a, 0xd4e9, 0x445a,
  [0xb9, 0x91, 0xca, 0x21, 0xca, 0x15, 0x7d, 0xc2],
);
