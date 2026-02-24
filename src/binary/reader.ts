const TEXT_DECODER = new TextDecoder("utf-8");

export class BinaryReader {
  private readonly view: DataView;
  private readonly bytes: Uint8Array;
  private _offset: number;

  constructor(buffer: ArrayBuffer | Uint8Array) {
    if (buffer instanceof Uint8Array) {
      this.bytes = buffer;
      this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    } else {
      this.bytes = new Uint8Array(buffer);
      this.view = new DataView(buffer);
    }
    this._offset = 0;
  }

  get offset(): number {
    return this._offset;
  }

  get remaining(): number {
    return this.bytes.byteLength - this._offset;
  }

  readUlonglong(): bigint {
    const val = this.view.getBigUint64(this._offset, true);
    this._offset += 8;
    return val;
  }

  readUlong(): number {
    const val = this.view.getUint32(this._offset, true);
    this._offset += 4;
    return val;
  }

  readUshort(): number {
    const val = this.view.getUint16(this._offset, true);
    this._offset += 2;
    return val;
  }

  readUbyte(): number {
    const val = this.view.getUint8(this._offset);
    this._offset += 1;
    return val;
  }

  readBool(): boolean {
    return this.readUbyte() !== 0;
  }

  readBytes(count: number): Uint8Array {
    const slice = this.bytes.slice(this._offset, this._offset + count);
    this._offset += count;
    return slice;
  }

  readArray(): Uint8Array {
    const length = this.readUlong();
    return this.readBytes(length);
  }

  readString(): string {
    const bytes = this.readArray();
    return TEXT_DECODER.decode(bytes);
  }

  readFloat32(): number {
    const val = this.view.getFloat32(this._offset, true);
    this._offset += 4;
    return val;
  }

  readFloat32Array(count: number): readonly number[] {
    const result: number[] = [];
    for (let i = 0; i < count; i++) {
      result.push(this.readFloat32());
    }
    return result;
  }
}
