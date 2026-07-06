import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import {
  KEY_DERIVATION_MESSAGE,
  PAYLOAD_VERSION_INLINE,
  decryptFulfillment,
  deriveMerchantKeyPair,
  encryptFulfillment,
} from "../src/crypto";
import { hashFulfillmentSchema, parseStoreConfig, type FulfillmentField } from "../src/storeConfig";
import { hexToBytes } from "viem";

// anvil dev key #1 — test-only
const MERCHANT_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;

const FIELDS = { email: "buyer@example.com", shipping_address: "1 Main St\nSpringfield" };

async function merchantKeyPair() {
  const account = privateKeyToAccount(MERCHANT_KEY);
  const signature = await account.signMessage({ message: KEY_DERIVATION_MESSAGE });
  return deriveMerchantKeyPair(signature);
}

describe("fulfillment encryption", () => {
  it("round-trips buyer → merchant", async () => {
    const merchant = await merchantKeyPair();
    const payload = encryptFulfillment(FIELDS, merchant.publicKey);
    expect(decryptFulfillment(payload, merchant.secretKey)).toEqual(FIELDS);
  });

  it("key derivation is deterministic across re-signing", async () => {
    const [a, b] = [await merchantKeyPair(), await merchantKeyPair()];
    expect(a.publicKey).toBe(b.publicKey);
  });

  it("payload starts with the inline version byte and is non-deterministic", async () => {
    const merchant = await merchantKeyPair();
    const p1 = encryptFulfillment(FIELDS, merchant.publicKey);
    const p2 = encryptFulfillment(FIELDS, merchant.publicKey);
    expect(hexToBytes(p1)[0]).toBe(PAYLOAD_VERSION_INLINE);
    expect(p1).not.toBe(p2); // fresh ephemeral key + nonce every time
  });

  it("rejects the wrong key", async () => {
    const merchant = await merchantKeyPair();
    const other = deriveMerchantKeyPair("0x1234");
    const payload = encryptFulfillment(FIELDS, merchant.publicKey);
    expect(() => decryptFulfillment(payload, other.secretKey)).toThrow(/decryption failed/);
  });

  it("rejects tampered ciphertext", async () => {
    const merchant = await merchantKeyPair();
    const payload = encryptFulfillment(FIELDS, merchant.publicKey);
    const tampered = (payload.slice(0, -2) + (payload.endsWith("00") ? "01" : "00")) as `0x${string}`;
    expect(() => decryptFulfillment(tampered, merchant.secretKey)).toThrow(/decryption failed/);
  });

  it("rejects unknown payload versions", async () => {
    const merchant = await merchantKeyPair();
    const payload = encryptFulfillment(FIELDS, merchant.publicKey);
    const wrongVersion = ("0x02" + payload.slice(4)) as `0x${string}`;
    expect(() => decryptFulfillment(wrongVersion, merchant.secretKey)).toThrow(/unsupported payload version/);
  });
});

describe("fulfillment schema hash", () => {
  const schema: FulfillmentField[] = [
    { name: "email", label: "Email", type: "email", required: true },
    { name: "shipping_address", label: "Shipping address", type: "textarea", required: true },
  ];

  it("is stable for identical schemas and sensitive to changes", () => {
    const h = hashFulfillmentSchema(schema);
    expect(hashFulfillmentSchema(JSON.parse(JSON.stringify(schema)))).toBe(h);
    expect(hashFulfillmentSchema([schema[1], schema[0]])).not.toBe(h);
  });
});

describe("parseStoreConfig", () => {
  const valid = {
    version: 1,
    chainId: 11155111,
    storeAddress: "0x1111111111111111111111111111111111111111",
    product: { name: "Thing", description: "A thing.", images: ["/thing.png"] },
    payment: {
      token: "0x0000000000000000000000000000000000000000",
      symbol: "ETH",
      decimals: 18,
      price: "10000000000000000",
    },
    fulfillment: { fields: [{ name: "email", label: "Email", type: "email", required: true }] },
  };

  it("accepts a valid config", () => {
    expect(parseStoreConfig(structuredClone(valid)).product.name).toBe("Thing");
  });

  it.each([
    ["version", { ...valid, version: 2 }],
    ["storeAddress", { ...valid, storeAddress: "nope" }],
    ["price", { ...valid, payment: { ...valid.payment, price: "1.5" } }],
    ["empty fields", { ...valid, fulfillment: { fields: [] } }],
    [
      "duplicate field names",
      {
        ...valid,
        fulfillment: {
          fields: [
            { name: "email", label: "Email", type: "email", required: true },
            { name: "email", label: "Email again", type: "text", required: false },
          ],
        },
      },
    ],
  ])("rejects bad %s", (_label, cfg) => {
    expect(() => parseStoreConfig(cfg)).toThrow(/invalid store.config.json/);
  });
});
