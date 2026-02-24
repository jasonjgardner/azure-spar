import type { BinaryReader } from "../binary/reader.ts";
import type { BinaryWriter } from "../binary/writer.ts";
import { EncryptionType } from "./enums.ts";
import { EncryptionError } from "../errors.ts";

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder("utf-8");

export function readEncryptionType(reader: BinaryReader): EncryptionType {
  const bytes = reader.readBytes(4);
  const tag = TEXT_DECODER.decode(bytes);
  const reversed = tag.split("").reverse().join("");
  if (!Object.values(EncryptionType).includes(reversed as EncryptionType)) {
    throw new EncryptionError(`Unknown encryption type: ${reversed}`);
  }
  return reversed as EncryptionType;
}

export function writeEncryptionType(writer: BinaryWriter, type: EncryptionType): void {
  const reversed = type.split("").reverse().join("");
  writer.writeBytes(TEXT_ENCODER.encode(reversed));
}

/**
 * AES-GCM decryption using AES-CTR mode.
 *
 * The Python original uses pycryptodome's AES.GCM.decrypt() which skips
 * GCM authentication tag verification. Since Web Crypto's AES-GCM always
 * verifies the tag (and the material format doesn't store it), we replicate
 * GCM's CTR-mode encryption directly using AES-CTR.
 *
 * In GCM with a 12-byte nonce, data encryption uses AES-CTR starting at
 * counter value 2 (counter 1 is reserved for the auth tag).
 */
export async function decryptAesGcm(
  key: Uint8Array,
  nonce: Uint8Array,
  ciphertext: Uint8Array,
): Promise<Uint8Array> {
  const truncatedNonce = nonce.slice(0, 12);

  // Build the initial counter block: [nonce (12 bytes)][counter=2 (4 bytes big-endian)]
  const counterBlock = new Uint8Array(16);
  counterBlock.set(truncatedNonce, 0);
  counterBlock[15] = 2; // big-endian 0x00000002

  const keyBuffer = new ArrayBuffer(key.byteLength);
  new Uint8Array(keyBuffer).set(key);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBuffer,
    "AES-CTR",
    false,
    ["decrypt"],
  );

  const ctBuffer = new ArrayBuffer(ciphertext.byteLength);
  new Uint8Array(ctBuffer).set(ciphertext);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-CTR", counter: counterBlock, length: 32 },
    cryptoKey,
    ctBuffer,
  );

  return new Uint8Array(plaintext);
}

export async function encryptAesGcm(
  key: Uint8Array,
  nonce: Uint8Array,
  plaintext: Uint8Array,
): Promise<Uint8Array> {
  const truncatedNonce = nonce.slice(0, 12);

  const counterBlock = new Uint8Array(16);
  counterBlock.set(truncatedNonce, 0);
  counterBlock[15] = 2;

  const keyBuffer = new ArrayBuffer(key.byteLength);
  new Uint8Array(keyBuffer).set(key);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyBuffer,
    "AES-CTR",
    false,
    ["encrypt"],
  );

  const ptBuffer = new ArrayBuffer(plaintext.byteLength);
  new Uint8Array(ptBuffer).set(plaintext);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-CTR", counter: counterBlock, length: 32 },
    cryptoKey,
    ptBuffer,
  );

  return new Uint8Array(ciphertext);
}
