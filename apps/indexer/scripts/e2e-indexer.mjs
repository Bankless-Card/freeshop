/**
 * Integration test for the indexer: seeds a chain (factory, two stores, orders from
 * overlapping buyers, a fulfilment, a refund, a withdrawal), runs `ponder dev` over it, then
 * asserts the analytics — including the cross-store unique-buyer dedup — and decrypts an
 * order blob fetched from the API with the merchant's signature-derived key.
 *
 * Prereqs: `forge build --root contracts`, anvil on PATH.
 */
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { readFileSync, rmSync } from "node:fs";
import nacl from "tweetnacl";
import {
  createPublicClient,
  createWalletClient,
  hexToBytes,
  http,
  keccak256,
  parseEther,
  parseEventLogs,
  stringToBytes,
  bytesToHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { anvil } from "viem/chains";

const ANVIL_PORT = 9548;
const PONDER_PORT = 42011;
const RPC = `http://127.0.0.1:${ANVIL_PORT}`;

const MERCHANT_PK = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const BUYER_A_PK = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const BUYER_B_PK = "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a";

// Mirrors @freeshop/shared (which is TS — inlined here so this stays a plain node script).
const KEY_DERIVATION_MESSAGE =
  "freeshop encryption key v1\n\n" +
  "Signing this message derives the private key that decrypts your customers' order details.\n" +
  "Only sign it on your own freeshop dashboard or tooling you trust.";
const FIELDS = { email: "buyer@example.com", shipping_address: "1 Main St" };

const children = [];
// Spawn detached and kill the whole process group: `pnpm exec ponder` is a wrapper, and
// killing just the wrapper orphans the actual indexer.
process.on("exit", () => {
  for (const child of children) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
});
const start = (cmd, args, opts = {}) => {
  const child = spawn(cmd, args, { stdio: "ignore", detached: true, ...opts });
  children.push(child);
  return child;
};

const publicClient = createPublicClient({ chain: anvil, transport: http(RPC) });
const wallet = (pk) =>
  createWalletClient({ account: privateKeyToAccount(pk), chain: anvil, transport: http(RPC) });
const merchant = wallet(MERCHANT_PK);
const buyerA = wallet(BUYER_A_PK);
const buyerB = wallet(BUYER_B_PK);

const artifact = (name) =>
  JSON.parse(readFileSync(new URL(`../../../contracts/out/${name}.sol/${name}.json`, import.meta.url), "utf8"));

async function send(promise) {
  const hash = await promise;
  return publicClient.waitForTransactionReceipt({ hash });
}

// ——— chain setup ———
start("anvil", ["--port", String(ANVIL_PORT), "--silent"]);
{
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
}

const factoryAbi = artifact("StorefrontFactory").abi;
const escrowAbi = artifact("StoreEscrow").abi;

const factoryReceipt = await send(
  merchant.deployContract({
    abi: factoryAbi,
    bytecode: artifact("StorefrontFactory").bytecode.object,
    args: [merchant.account.address, merchant.account.address, 0n],
  }),
);
const factoryAddress = factoryReceipt.contractAddress;

// Merchant encryption key, derived exactly like the dashboard does.
const signature = await merchant.signMessage({ message: KEY_DERIVATION_MESSAGE });
const merchantKeys = nacl.box.keyPair.fromSecretKey(hexToBytes(keccak256(signature)));

const PRICE = parseEther("0.01");
async function deployStore() {
  const receipt = await send(
    merchant.writeContract({
      address: factoryAddress,
      abi: factoryAbi,
      functionName: "deployStore",
      args: [
        merchant.account.address,
        "0x0000000000000000000000000000000000000000",
        PRICE,
        bytesToHex(merchantKeys.publicKey),
        `0x${"22".repeat(32)}`,
      ],
    }),
  );
  return parseEventLogs({ abi: factoryAbi, eventName: "StoreDeployed", logs: receipt.logs })[0].args.store;
}
const store1 = await deployStore();
const store2 = await deployStore();

function encrypt(fields) {
  const ephemeral = nacl.box.keyPair();
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const box = nacl.box(stringToBytes(JSON.stringify(fields)), nonce, merchantKeys.publicKey, ephemeral.secretKey);
  const payload = new Uint8Array(1 + 32 + nonce.length + box.length);
  payload[0] = 0x01;
  payload.set(ephemeral.publicKey, 1);
  payload.set(nonce, 33);
  payload.set(box, 33 + nonce.length);
  return bytesToHex(payload);
}

const pay = (buyer, store, blob) =>
  send(buyer.writeContract({ address: store, abi: escrowAbi, functionName: "pay", args: [blob], value: PRICE }));

// Orders: A twice + B once at store1; A once at store2 → 4 sales, 2 unique buyers overall
// (A must not double-count across stores), store1 = 3 sales / 2 unique, store2 = 1 / 1.
await pay(buyerA, store1, encrypt(FIELDS));
await pay(buyerA, store1, "0x01aa");
await pay(buyerB, store1, "0x01bb");
await pay(buyerA, store2, "0x01cc");

await send(merchant.writeContract({ address: store1, abi: escrowAbi, functionName: "setStatus", args: [2n, 2] }));
await send(merchant.writeContract({ address: store1, abi: escrowAbi, functionName: "refund", args: [3n] }));
await send(merchant.writeContract({ address: store1, abi: escrowAbi, functionName: "withdraw", args: [] }));

// ——— run ponder over the seeded chain ———
// Scratch database so this never collides with a dev indexer using .ponder/.
const scratchDb = new URL("../.ponder-e2e", import.meta.url).pathname;
rmSync(scratchDb, { recursive: true, force: true });
start("pnpm", ["exec", "ponder", "dev", "--port", String(PONDER_PORT), "--log-level", "warn"], {
  cwd: new URL("..", import.meta.url).pathname,
  stdio: process.env.DEBUG ? "inherit" : "ignore",
  env: {
    ...process.env,
    INDEXER_RPC_URL: RPC,
    INDEXER_CHAIN_ID: "31337",
    FACTORY_ADDRESS: factoryAddress,
    START_BLOCK: "0",
    PONDER_PGLITE_DIR: scratchDb,
    DATABASE_URL: "",
  },
});

const api = async (path) => {
  const response = await fetch(`http://localhost:${PONDER_PORT}${path}`);
  assert.equal(response.status, 200, `${path} responds`);
  return response.json();
};

// /ready alone is not a reliable "backfill done" signal — poll until the data is actually there.
{
  const deadline = Date.now() + 120_000;
  for (;;) {
    try {
      const probe = await api(`/merchants/${merchant.account.address}/analytics`);
      if (probe.stores.length === 2 && probe.aggregate.sales === 4) break;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error("ponder never served the seeded data");
    await new Promise((r) => setTimeout(r, 500));
  }
}

// ——— assertions ———
const merchantAnalytics = await api(`/merchants/${merchant.account.address}/analytics`);
if (process.env.DEBUG) {
  console.log("analytics:", JSON.stringify(merchantAnalytics, null, 2));
  console.log("orders:", JSON.stringify(await api(`/stores/${store1}/orders`), null, 2));
}
assert.equal(merchantAnalytics.aggregate.sales, 4, "aggregate sales");
assert.equal(merchantAnalytics.aggregate.uniqueBuyers, 2, "unique buyers deduped across stores");
assert.equal(merchantAnalytics.aggregate.refunds, 1, "aggregate refunds");
assert.equal(merchantAnalytics.aggregate.unfulfilled, 2, "unfulfilled = PAID orders");
assert.equal(merchantAnalytics.stores.length, 2, "both stores listed");
assert.equal(
  merchantAnalytics.aggregate.revenue[0].gross,
  (PRICE * 4n).toString(),
  "gross revenue",
);
assert.ok(
  merchantAnalytics.aggregate.salesByDay.reduce((n, d) => n + d.sales, 0) === 4,
  "sales-over-time buckets cover all sales",
);

const store1Stats = merchantAnalytics.stores.find((s) => s.address.toLowerCase() === store1.toLowerCase());
assert.equal(store1Stats.sales, 3, "store1 sales");
assert.equal(store1Stats.uniqueBuyers, 2, "store1 unique buyers");
const store2Stats = merchantAnalytics.stores.find((s) => s.address.toLowerCase() === store2.toLowerCase());
assert.equal(store2Stats.sales, 1, "store2 sales");

const store1Analytics = await api(`/stores/${store1}/analytics`);
assert.equal(store1Analytics.sales, 3, "per-store analytics endpoint");
assert.equal(store1Analytics.refunds, 1, "per-store refunds");

const { orders } = await api(`/stores/${store1}/orders`);
assert.equal(orders.length, 3, "orders listed");
const byId = Object.fromEntries(orders.map((o) => [o.orderId, o]));
assert.equal(byId["1"].status, "PAID");
assert.equal(byId["2"].status, "FULFILLED", "StatusChanged indexed");
assert.equal(byId["3"].status, "REFUNDED", "Refunded indexed");
assert.equal(byId["1"].buyer.toLowerCase(), buyerA.account.address.toLowerCase());

// Open orders (need merchant input): everything not FULFILLED/REFUNDED, across both stores.
const openOrders = await api(`/merchants/${merchant.account.address}/open-orders`);
assert.equal(openOrders.orders.length, 2, "open orders = the two PAID orders");
assert.ok(
  openOrders.orders.every((o) => o.status === "PAID" || o.status === "CANCELLED"),
  "open orders exclude FULFILLED and REFUNDED",
);
assert.ok(
  new Set(openOrders.orders.map((o) => o.store)).size === 2,
  "open orders span both stores",
);

// Decrypt order 1's blob straight from the API response with the merchant's derived key.
{
  const payload = hexToBytes(byId["1"].encryptedFulfillment);
  assert.equal(payload[0], 0x01, "payload version byte");
  const ephemeralPub = payload.slice(1, 33);
  const nonce = payload.slice(33, 33 + nacl.box.nonceLength);
  const box = payload.slice(33 + nacl.box.nonceLength);
  const plaintext = nacl.box.open(box, nonce, ephemeralPub, merchantKeys.secretKey);
  assert.ok(plaintext, "decryption succeeds");
  assert.deepEqual(JSON.parse(new TextDecoder().decode(plaintext)), FIELDS, "fulfillment round-trips via indexer");
}

console.log("indexer e2e: all assertions passed");
process.exit(0);
