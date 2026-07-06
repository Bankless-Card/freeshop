import nacl from "tweetnacl";
import { bytesToHex, hexToBytes, keccak256, stringToBytes, type Hex } from "viem";

/**
 * Fulfillment payloads are NaCl boxes encrypted to the merchant's x25519 public key with an
 * ephemeral sender key, wire format:
 *
 *   version(1) || ephemeralPubKey(32) || nonce(24) || box(ciphertext)
 *
 * The leading version byte keeps the door open for a future off-chain variant (e.g. a CID
 * reference) without changing the OrderPlaced event schema.
 */
export const PAYLOAD_VERSION_INLINE = 0x01;

/**
 * Fixed message a merchant signs (EIP-191 personal_sign) to derive their encryption keypair.
 * The keccak256 of the signature seeds the x25519 secret key, so the merchant can re-derive
 * the same keypair any time from the same wallet — nothing to back up.
 *
 * Changing this string changes every merchant's derived key. Never change it after launch.
 */
export const KEY_DERIVATION_MESSAGE =
  "freeshop encryption key v1\n\n" +
  "Signing this message derives the private key that decrypts your customers' order details.\n" +
  "Only sign it on your own freeshop dashboard or tooling you trust.";

export interface MerchantKeyPair {
  /** 32-byte x25519 public key, hex — stored on-chain as the store's merchantPubKey. */
  publicKey: Hex;
  secretKey: Uint8Array;
}

/** Derives the merchant encryption keypair from their signature over KEY_DERIVATION_MESSAGE. */
export function deriveMerchantKeyPair(signature: Hex): MerchantKeyPair {
  const seed = hexToBytes(keccak256(signature));
  const pair = nacl.box.keyPair.fromSecretKey(seed);
  return { publicKey: bytesToHex(pair.publicKey), secretKey: pair.secretKey };
}

/** Encrypts fulfillment fields (buyer side) to the merchant's x25519 public key. */
export function encryptFulfillment(fields: Record<string, string>, merchantPubKey: Hex): Hex {
  const pubKey = hexToBytes(merchantPubKey);
  if (pubKey.length !== 32) throw new Error("merchantPubKey must be 32 bytes");
  const plaintext = stringToBytes(JSON.stringify(fields));
  const ephemeral = nacl.box.keyPair();
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const box = nacl.box(plaintext, nonce, pubKey, ephemeral.secretKey);

  const payload = new Uint8Array(1 + 32 + nacl.box.nonceLength + box.length);
  payload[0] = PAYLOAD_VERSION_INLINE;
  payload.set(ephemeral.publicKey, 1);
  payload.set(nonce, 33);
  payload.set(box, 33 + nacl.box.nonceLength);
  return bytesToHex(payload);
}

/** Decrypts an OrderPlaced payload (merchant side) with the derived secret key. */
export function decryptFulfillment(payload: Hex, secretKey: Uint8Array): Record<string, string> {
  const bytes = hexToBytes(payload);
  if (bytes.length < 1 + 32 + nacl.box.nonceLength + nacl.box.overheadLength) {
    throw new Error("payload too short");
  }
  if (bytes[0] !== PAYLOAD_VERSION_INLINE) {
    throw new Error(`unsupported payload version: ${bytes[0]}`);
  }
  const ephemeralPubKey = bytes.slice(1, 33);
  const nonce = bytes.slice(33, 33 + nacl.box.nonceLength);
  const box = bytes.slice(33 + nacl.box.nonceLength);
  const plaintext = nacl.box.open(box, nonce, ephemeralPubKey, secretKey);
  if (!plaintext) throw new Error("decryption failed: wrong key or corrupted payload");
  return JSON.parse(new TextDecoder().decode(plaintext));
}
