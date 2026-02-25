/**
 * COM vtable call primitives for x64 Windows.
 *
 * On x64, all calling conventions (stdcall, cdecl, fastcall, thiscall)
 * collapse to the single Microsoft x64 ABI. This means COM interface
 * methods can be called through bun:ffi's CFunction with the object
 * pointer passed as the first argument.
 *
 * COM object memory layout:
 *   [objectPtr + 0] → vtable pointer
 *   [vtablePtr + index * 8] → function pointer for method at that index
 *
 * IUnknown vtable (indices 0-2):
 *   0: QueryInterface(this, riid, ppv)
 *   1: AddRef(this)
 *   2: Release(this)
 */

import { CFunction, read, type FFITypeOrString, type Pointer } from "bun:ffi";

const POINTER_SIZE = 8;

/** Cast a plain number to the branded Pointer type expected by bun:ffi. */
export function asPointer(n: number): Pointer {
  return n as unknown as Pointer;
}

/** Signature definition for a COM vtable method. */
export interface VtableMethodSignature {
  readonly args: readonly FFITypeOrString[];
  readonly returns: FFITypeOrString;
}

/** Read a function pointer from a COM object's vtable at the given method index. */
export function getVtableMethodPtr(comObj: number, methodIndex: number): number {
  const vtablePtr = read.ptr(asPointer(comObj), 0);
  return read.ptr(asPointer(vtablePtr), methodIndex * POINTER_SIZE);
}

/**
 * Call a COM vtable method on an object.
 *
 * The `this` pointer (comObj) is automatically prepended as the first argument.
 * The signature.args should NOT include the `this` pointer — it is added internally.
 *
 * @param comObj - Pointer to the COM object (the `this` pointer)
 * @param methodIndex - Vtable slot index (0 = QueryInterface, 1 = AddRef, 2 = Release, 3+ = interface methods)
 * @param signature - Argument types (excluding `this`) and return type
 * @param args - Arguments to pass after the `this` pointer
 */
export function callVtableMethod(
  comObj: number,
  methodIndex: number,
  signature: VtableMethodSignature,
  ...args: readonly unknown[]
): unknown {
  const fnPtr = getVtableMethodPtr(comObj, methodIndex);
  const fn = CFunction({
    ptr: asPointer(fnPtr),
    args: ["ptr", ...signature.args],
    returns: signature.returns,
  });
  return fn(comObj, ...args);
}

/**
 * Call IUnknown::Release (vtable index 2) on a COM object.
 * Returns the new reference count.
 */
export function comRelease(comObj: number): number {
  if (!comObj) return 0;
  return callVtableMethod(comObj, 2, { args: [], returns: "u32" }) as number;
}

/**
 * Call IUnknown::AddRef (vtable index 1) on a COM object.
 * Returns the new reference count.
 */
export function comAddRef(comObj: number): number {
  if (!comObj) return 0;
  return callVtableMethod(comObj, 1, { args: [], returns: "u32" }) as number;
}

/**
 * Release an array of COM objects, ignoring nulls.
 * Used in finally blocks to clean up all acquired COM references.
 */
export function comReleaseAll(objects: readonly number[]): void {
  for (const obj of objects) {
    if (obj) comRelease(obj);
  }
}
