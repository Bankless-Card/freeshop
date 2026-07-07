/**
 * Headless e2e for the launcher API: SIWE sign-in with a real signature, merchant email CRUD,
 * and storefront package generation. Runs the production server against a local anvil.
 *
 * Prereqs: `pnpm build` (this app), `pnpm prepare-template`, anvil on PATH.
 */
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unzipSync, strFromU8 } from "fflate";
import { createPublicClient, createTestClient, createWalletClient, http, parseEther, parseEventLogs } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { anvil } from "viem/chains";
import { createSiweMessage } from "viem/siwe";

const PORT = 3999;
const BASE = `http://localhost:${PORT}`;
const ANVIL_PORT = 8545; // must match the RPC baked into the build (anvil default)
// Fresh random key per run: SIWE needs no funds, and this keeps the test from colliding with
// accounts a human created in the local PGlite DB (e.g. via the anvil dev keys).
const MERCHANT_PK = generatePrivateKey();

const children = [];
const cleanup = () => children.forEach((child) => child.kill());
process.on("exit", cleanup);

function start(command, args, options = {}) {
  const child = spawn(command, args, { stdio: "ignore", ...options });
  children.push(child);
  return child;
}

async function waitFor(url, timeoutMs = 30_000, requireJson = false) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const response = await fetch(url);
      if (!requireJson || (response.ok && (response.headers.get("content-type") ?? "").includes("json"))) {
        return;
      }
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${url}`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

/** Minimal cookie jar (iron-session uses a single session cookie). */
let cookie = "";
async function api(path, init = {}) {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { ...(init.headers ?? {}), ...(cookie ? { cookie } : {}) },
  });
  const setCookie = response.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];
  const json = response.json.bind(response);
  response.json = async () => {
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`${path} returned ${response.status} with non-JSON body: ${text.slice(0, 200)}`);
    }
  };
  void json;
  return response;
}

// ——— boot ———
start("anvil", ["--port", String(ANVIL_PORT), "--silent"]);
start("pnpm", ["exec", "next", "start", "-p", String(PORT)], {
  env: { ...process.env, SESSION_SECRET: "e2e-test-session-secret-0123456789abcdef" },
});
await waitFor(`http://127.0.0.1:${ANVIL_PORT}`);
await waitFor(`${BASE}/api/me`, 30_000, true);

// ——— unauthenticated ———
assert.equal((await (await api("/api/me")).json()).authenticated, false, "starts signed out");
assert.equal((await api("/api/storefront-package", { method: "POST", body: "{}" })).status, 401, "package requires auth");

// ——— SIWE: bad nonce is rejected ———
const account = privateKeyToAccount(MERCHANT_PK);
const wallet = createWalletClient({ account, chain: anvil, transport: http(`http://127.0.0.1:${ANVIL_PORT}`) });
const siweFields = { address: account.address, chainId: 31337, domain: `localhost:${PORT}`, uri: BASE, version: "1" };

await api("/api/auth/nonce");
{
  const message = createSiweMessage({ ...siweFields, nonce: "deadbeefdeadbeef" });
  const signature = await wallet.signMessage({ message });
  const response = await api("/api/auth/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, signature }),
  });
  assert.equal(response.status, 401, "wrong nonce rejected");
}

// ——— SIWE: real sign-in ———
{
  const { nonce } = await (await api("/api/auth/nonce")).json();
  const message = createSiweMessage({ ...siweFields, nonce });
  const signature = await wallet.signMessage({ message });
  const response = await api("/api/auth/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, signature }),
  });
  assert.equal(response.status, 200, "SIWE verify succeeds");
  assert.equal((await response.json()).address, account.address.toLowerCase());
}

// ——— merchant account CRUD ———
{
  let me = await (await api("/api/me")).json();
  assert.equal(me.authenticated, true);
  assert.equal(me.email, null, "no email before onboarding");

  const bad = await api("/api/me", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "not-an-email" }),
  });
  assert.equal(bad.status, 400, "invalid email rejected");

  const put = await api("/api/me", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "merchant@example.com" }),
  });
  assert.equal(put.status, 200);
  me = await (await api("/api/me")).json();
  assert.equal(me.email, "merchant@example.com", "email persisted");

  await api("/api/me", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "updated@example.com" }),
  });
  me = await (await api("/api/me")).json();
  assert.equal(me.email, "updated@example.com", "email updated");
}

// ——— storefront package ———
{
  const config = {
    version: 1,
    chainId: 31337,
    storeAddress: "0xa16E02E87b7454126E5E10d957A927A7F5B5d2be",
    product: { name: "E2E Product", description: "desc", images: ["./product.svg"] },
    payment: {
      token: "0x0000000000000000000000000000000000000000",
      symbol: "ETH",
      decimals: 18,
      price: "1000000000000000",
    },
    fulfillment: { fields: [{ name: "email", label: "Email", type: "email", required: true }] },
  };
  const response = await api("/api/storefront-package", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(config),
  });
  assert.equal(response.status, 200, "package generated");
  assert.equal(response.headers.get("content-type"), "application/zip");

  const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
  assert.ok(files["index.html"], "zip contains the built site");
  const packaged = JSON.parse(strFromU8(files["store.config.json"]));
  assert.equal(packaged.product.name, "E2E Product", "zip contains the merchant's config");

  const invalid = await api("/api/storefront-package", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...config, storeAddress: "nope" }),
  });
  assert.equal(invalid.status, 400, "invalid config rejected");
}

// ——— store-config persistence (deploy a real store owned by the session merchant) ———
{
  const rpc = `http://127.0.0.1:${ANVIL_PORT}`;
  const account = privateKeyToAccount(MERCHANT_PK);
  const publicClient = createPublicClient({ chain: anvil, transport: http(rpc) });
  const testClient = createTestClient({ mode: "anvil", chain: anvil, transport: http(rpc) });
  const wallet = createWalletClient({ account, chain: anvil, transport: http(rpc) });
  await testClient.setBalance({ address: account.address, value: parseEther("1") });

  const artifact = (name) =>
    JSON.parse(readFileSync(new URL(`../../../contracts/out/${name}.sol/${name}.json`, import.meta.url), "utf8"));
  const factoryArtifact = artifact("StorefrontFactory");

  const deployHash = await wallet.deployContract({
    abi: factoryArtifact.abi,
    bytecode: factoryArtifact.bytecode.object,
    args: [account.address, account.address, 0n],
  });
  const factory = (await publicClient.waitForTransactionReceipt({ hash: deployHash })).contractAddress;

  const storeHash = await wallet.writeContract({
    address: factory,
    abi: factoryArtifact.abi,
    functionName: "deployStore",
    args: [
      account.address,
      "0x0000000000000000000000000000000000000000",
      parseEther("0.01"),
      `0x${"11".repeat(32)}`,
      `0x${"22".repeat(32)}`,
    ],
  });
  const storeReceipt = await publicClient.waitForTransactionReceipt({ hash: storeHash });
  const [deployed] = parseEventLogs({ abi: factoryArtifact.abi, eventName: "StoreDeployed", logs: storeReceipt.logs });
  const store = deployed.args.store;

  const config = {
    version: 1,
    chainId: 31337,
    storeAddress: store,
    product: { name: "Persisted Product", description: "", images: ["./product.svg"] },
    payment: {
      token: "0x0000000000000000000000000000000000000000",
      symbol: "ETH",
      decimals: 18,
      price: "10000000000000000",
    },
    fulfillment: { fields: [{ name: "email", label: "Email", type: "email", required: true }] },
  };

  const jsonInit = (method, body) => ({
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  assert.equal((await api(`/api/stores/${store}/config`)).status, 404, "no config saved yet");
  assert.equal((await api(`/api/stores/${store}/config`, jsonInit("PUT", config))).status, 200, "config saved");
  const fetched = await (await api(`/api/stores/${store}/config`)).json();
  assert.equal(fetched.config.product.name, "Persisted Product", "config round-trips");

  const mismatched = await api(
    `/api/stores/${store}/config`,
    jsonInit("PUT", { ...config, storeAddress: "0x1111111111111111111111111111111111111111" }),
  );
  assert.equal(mismatched.status, 400, "storeAddress/URL mismatch rejected");

  // A store whose on-chain merchant is someone else must be inaccessible to this session.
  const otherStoreHash = await wallet.writeContract({
    address: factory,
    abi: factoryArtifact.abi,
    functionName: "deployStore",
    args: [
      "0x2222222222222222222222222222222222222222",
      "0x0000000000000000000000000000000000000000",
      parseEther("0.01"),
      `0x${"11".repeat(32)}`,
      `0x${"22".repeat(32)}`,
    ],
  });
  const otherReceipt = await publicClient.waitForTransactionReceipt({ hash: otherStoreHash });
  const [otherDeployed] = parseEventLogs({
    abi: factoryArtifact.abi,
    eventName: "StoreDeployed",
    logs: otherReceipt.logs,
  });
  assert.equal(
    (await api(`/api/stores/${otherDeployed.args.store}/config`)).status,
    403,
    "someone else's store is forbidden",
  );
}

// ——— account deletion ———
{
  const del = await api("/api/me", { method: "DELETE" });
  assert.equal(del.status, 200);
  const me = await (await api("/api/me")).json();
  assert.equal(me.authenticated, false, "deleted account is signed out");
}

console.log("launcher API e2e: all assertions passed");
process.exit(0);
