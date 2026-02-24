const TEXT_ENCODER = new TextEncoder();

const INITIAL_CAPACITY = 4096;

export class BinaryWriter {
  private buffer: ArrayBuffer;
  private view: DataView;
  private _offset: number;

  constructor(initialCapacity: number = INITIAL_CAPACITY) {
    this.buffer = new ArrayBuffer(initialCapacity);
    this.view = new DataView(this.buffer);
    this._offset = 0;
  }

  get offset(): number {
    return this._offset;
  }

  private ensureCapacity(additional: number): void {
    const required = this._offset + additional;
    if (required <= this.buffer.byteLength) return;

    let newSize = this.buffer.byteLength;
    while (newSize < required) {
      newSize *= 2;
    }

    const newBuffer = new ArrayBuffer(newSize);
    new Uint8Array(newBuffer).set(new Uint8Array(this.buffer));
    this.buffer = newBuffer;
    this.view = new DataView(this.buffer);
  }

  writeUlonglong(val: bigint): void {
    this.ensureCapacity(8);
    this.view.setBigUint64(this._offset, val, true);
    this._offset += 8;
  }

  writeUlong(val: number): void {
    this.ensureCapacity(4);
    this.view.setUint32(this._offset, val, true);
    this._offset += 4;
  }

  writeUshort(val: number): void {
    this.ensureCapacity(2);
    this.view.setUint16(this._offset, val, true);
    this._offset += 2;
  }

  writeUbyte(val: number): void {
    this.ensureCapacity(1);
    this.view.setUint8(this._offset, val);
    this._offset += 1;
  }

  writeBool(val: boolean): void {
    this.writeUbyte(val ? 1 : 0);
  }

  writeBytes(val: Uint8Array): void {
    this.ensureCapacity(val.byteLength);
    new Uint8Array(this.buffer).set(val, this._offset);
    this._offset += val.byteLength;
  }

  writeArray(val: Uint8Array): void {
    this.writeUlong(val.byteLength);
    this.writeBytes(val);
  }

  writeString(val: string): void {
    const encoded = TEXT_ENCODER.encode(val);
    this.writeArray(encoded);
  }

  writeFloat32(val: number): void {
    this.ensureCapacity(4);
    this.view.setFloat32(this._offset, val, true);
    this._offset += 4;
  }

  writeFloat32Array(values: readonly number[]): void {
    for (const val of values) {
      this.writeFloat32(val);
    }
  }

  toUint8Array(): Uint8Array {
    return new Uint8Array(this.buffer, 0, this._offset);
  }
}
