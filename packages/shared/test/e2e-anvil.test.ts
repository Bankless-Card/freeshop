/**
 * End-to-end protocol test against a real chain (anvil): deploy factory + store with a
 * signature-derived merchant pubkey, buy with encrypted fulfillment, decrypt from the
 * OrderPlaced log as the merchant, fulfil, refund, withdraw.
 *
 * Requires `forge build --root contracts` to have produced contracts/out, and anvil on PATH.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  parseEventLogs,
  type Abi,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { anvil } from "viem/chains";
import {
  ETH_SENTINEL,
  KEY_DERIVATION_MESSAGE,
  decryptFulfillment,
  deriveMerchantKeyPair,
  encryptFulfillment,
  hashFulfillmentSchema,
  storeEscrowAbi,
  storefrontFactoryAbi,
  type FulfillmentField,
} from "../src";

const RPC_PORT = 9545;
const RPC_URL = `http://127.0.0.1:${RPC_PORT}`;

// anvil's well-known dev keys — test-only
const MERCHANT_PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const BUYER_PK = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;

const PRICE = parseEther("0.05");
const LAUNCH_FEE = parseEther("0.01");
const FIELDS = { email: "buyer@example.com", shipping_address: "1 Main St, Springfield" };
const SCHEMA: FulfillmentField[] = [
  { name: "email", label: "Email", type: "email", required: true },
  { name: "shipping_address", label: "Shipping address", type: "textarea", required: true },
];

function loadArtifact(name: string): { abi: Abi; bytecode: Hex } {
  const url = new URL(`../../../contracts/out/${name}.sol/${name}.json`, import.meta.url);
  let artifact: any;
  try {
    artifact = JSON.parse(readFileSync(url, "utf8"));
  } catch {
    throw new Error(`missing ${name} artifact — run \`forge build --root contracts\` first`);
  }
  return { abi: artifact.abi, bytecode: artifact.bytecode.object };
}

const merchantAccount = privateKeyToAccount(MERCHANT_PK);
const buyerAccount = privateKeyToAccount(BUYER_PK);
const publicClient = createPublicClient({ chain: anvil, transport: http(RPC_URL) });
const merchant = createWalletClient({ account: merchantAccount, chain: anvil, transport: http(RPC_URL) });
const buyer = createWalletClient({ account: buyerAccount, chain: anvil, transport: http(RPC_URL) });

let anvilProcess: ChildProcess;
let storeAddress: Hex;

async function deployStack(): Promise<Hex> {
  const factoryArtifact = loadArtifact("StorefrontFactory");
  const deployHash = await merchant.deployContract({
    abi: factoryArtifact.abi,
    bytecode: factoryArtifact.bytecode,
    args: [merchantAccount.address, merchantAccount.address, LAUNCH_FEE],
  });
  const factoryReceipt = await publicClient.waitForTransactionReceipt({ hash: deployHash });
  const factory = factoryReceipt.contractAddress!;

  // The merchant derives their encryption keypair exactly like the dashboard will: by signing.
  const signature = await merchant.signMessage({ message: KEY_DERIVATION_MESSAGE });
  const keys = deriveMerchantKeyPair(signature);

  const deployStoreHash = await merchant.writeContract({
    address: factory,
    abi: storefrontFactoryAbi,
    functionName: "deployStore",
    args: [merchantAccount.address, ETH_SENTINEL, PRICE, keys.publicKey, hashFulfillmentSchema(SCHEMA)],
    value: LAUNCH_FEE,
  });
  const storeReceipt = await publicClient.waitForTransactionReceipt({ hash: deployStoreHash });
  const [deployed] = parseEventLogs({
    abi: storefrontFactoryAbi,
    eventName: "StoreDeployed",
    logs: storeReceipt.logs,
  });
  return deployed.args.store;
}

beforeAll(async () => {
  anvilProcess = spawn("anvil", ["--port", String(RPC_PORT), "--silent"], { stdio: "ignore" });
  const deadline = Date.now() + 15_000;
  for (;;) {
    try {
      await publicClient.getBlockNumber();
      break;
    } catch {
      if (Date.now() > deadline) throw new Error("anvil did not start");
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  storeAddress = await deployStack();
}, 30_000);

afterAll(() => {
  anvilProcess?.kill();
});

describe("storefront purchase protocol on anvil", () => {
  it("buyer pays with encrypted fulfillment; merchant decrypts it from the log", async () => {
    const pubKey = await publicClient.readContract({
      address: storeAddress,
      abi: storeEscrowAbi,
      functionName: "merchantPubKey",
    });

    const payload = encryptFulfillment(FIELDS, pubKey);
    const payHash = await buyer.writeContract({
      address: storeAddress,
      abi: storeEscrowAbi,
      functionName: "pay",
      args: [payload],
      value: PRICE,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: payHash });
    const [placed] = parseEventLogs({ abi: storeEscrowAbi, eventName: "OrderPlaced", logs: receipt.logs });

    expect(placed.args.orderId).toBe(1n);
    expect(placed.args.buyer).toBe(buyerAccount.address);
    expect(placed.args.amount).toBe(PRICE);

    // Merchant re-derives the key from a fresh signature (new session) and reads the order.
    const signature = await merchant.signMessage({ message: KEY_DERIVATION_MESSAGE });
    const keys = deriveMerchantKeyPair(signature);
    expect(decryptFulfillment(placed.args.encryptedFulfillment, keys.secretKey)).toEqual(FIELDS);
  }, 30_000);

  it("merchant fulfils; status is readable the way the storefront reads it", async () => {
    const fulfillHash = await merchant.writeContract({
      address: storeAddress,
      abi: storeEscrowAbi,
      functionName: "setStatus",
      args: [1n, 2], // FULFILLED
    });
    await publicClient.waitForTransactionReceipt({ hash: fulfillHash });

    const [orderBuyer, amount, status] = await publicClient.readContract({
      address: storeAddress,
      abi: storeEscrowAbi,
      functionName: "orders",
      args: [1n],
    });
    expect(orderBuyer).toBe(buyerAccount.address);
    expect(amount).toBe(PRICE);
    expect(status).toBe(2);
  }, 30_000);

  it("merchant refunds a second order; buyer gets the ETH back", async () => {
    const payload = encryptFulfillment(FIELDS, await publicClient.readContract({
      address: storeAddress,
      abi: storeEscrowAbi,
      functionName: "merchantPubKey",
    }));
    const payHash = await buyer.writeContract({
      address: storeAddress,
      abi: storeEscrowAbi,
      functionName: "pay",
      args: [payload],
      value: PRICE,
    });
    await publicClient.waitForTransactionReceipt({ hash: payHash });

    const balanceBefore = await publicClient.getBalance({ address: buyerAccount.address });
    const refundHash = await merchant.writeContract({
      address: storeAddress,
      abi: storeEscrowAbi,
      functionName: "refund",
      args: [2n],
    });
    await publicClient.waitForTransactionReceipt({ hash: refundHash });

    expect(await publicClient.getBalance({ address: buyerAccount.address })).toBe(balanceBefore + PRICE);
    const [, , status] = await publicClient.readContract({
      address: storeAddress,
      abi: storeEscrowAbi,
      functionName: "orders",
      args: [2n],
    });
    expect(status).toBe(4); // REFUNDED
  }, 30_000);

  it("withdraw sends the remaining balance to the merchant", async () => {
    const available = await publicClient.readContract({
      address: storeAddress,
      abi: storeEscrowAbi,
      functionName: "availableBalance",
    });
    expect(available).toBe(PRICE); // one live order remains after the refund

    const withdrawHash = await buyer.writeContract({
      // anyone can call; funds still go to the merchant
      address: storeAddress,
      abi: storeEscrowAbi,
      functionName: "withdraw",
    });
    await publicClient.waitForTransactionReceipt({ hash: withdrawHash });

    expect(
      await publicClient.readContract({ address: storeAddress, abi: storeEscrowAbi, functionName: "availableBalance" }),
    ).toBe(0n);
  }, 30_000);
});
