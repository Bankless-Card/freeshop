# Testing procedure (M1–M3)

Two layers: the automated suites (run in minutes, prove the protocol), and a manual walkthrough
for everything a wallet extension touches — which automation cannot cover in this repo yet.

---

## Part 0 — Automated suites (~2 min)

```sh
cd ~/projects/freeshop
export PATH="$HOME/.nvm/versions/node/v24.1.0/bin:$PATH"   # Node >= 22.12 required

pnpm contracts:test                    # 58 Foundry tests: units, fuzz, invariants
pnpm --filter @freeshop/shared test    # crypto round-trip + full anvil protocol e2e (17 tests)

cd apps/launcher
pnpm build && pnpm prepare-template
node scripts/e2e-api.mjs               # SIWE, email CRUD, storefront-zip assertions
```

All three must pass. They cover: every contract path (including hostile refund recipients and
reentrancy), encryption/decryption via signature-derived keys, pay → fulfil → refund → withdraw
on a real chain, SIWE auth incl. forged-nonce rejection, and package generation.

**Not covered — hence the manual part:** wallet popups, network switching, the browser UI, and
the merchant journey end to end.

---

## Part 1 — Manual walkthrough (local anvil, ~20 min, no real money)

### Setup (once)

Use a **throwaway browser profile** with MetaMask. You will import anvil's publicly-known dev
keys — they must never live next to real funds.

1. Add network — RPC `http://127.0.0.1:8545`, chain ID `31337`, currency `ETH`, name `Anvil`.
2. Import **merchant** account #0:
   `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80`
3. Import **buyer** account #1:
   `0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d`

### 1. Chain + factory

```sh
anvil                                                   # terminal 1, leave running
# terminal 2:
cd ~/projects/freeshop/contracts
forge script script/Deploy.s.sol --rpc-url http://localhost:8545 --broadcast \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

Note the printed `StorefrontFactory:` address.

### 2. Launcher — merchant journey

```sh
cd ~/projects/freeshop/apps/launcher
NEXT_PUBLIC_FACTORY_ADDRESS=<factory address> pnpm dev
```

At `http://localhost:3000`, **switch MetaMask to the Anvil network first**, then as the
merchant account verify:

- [ ] Connect → **Sign in with Ethereum** → signature popup (a signature, not a transaction) → lands on onboarding.
- [ ] Onboarding refuses to continue until a valid email **and** both acknowledgements are checked.
- [ ] Wizard step 1: product name/price required; payout-address hint says it is permanent.
- [ ] Wizard step 2: add/remove form fields; a duplicate field key blocks Next.
- [ ] Wizard step 3: **Sign to create key** → signature popup → public key appears; loss + phishing warnings read sensibly.
- [ ] Wizard step 4: launch fee shows **0.01 ETH** (read live from the factory) and a gas estimate; the network row shows `Anvil (id 31337)`.
      If the button reads **"Switch wallet to Anvil"**, click it — it performs the switch and
      resyncs; it should then flip to **Launch store**. (If it ever shows switch while MetaMask
      is already on Anvil and clicking doesn't clear it, that's a bug — report the chain id the
      row displays.)
- [ ] Launch → 0.01 ETH transaction popup → **Launched** stamp + store address.
- [ ] Download **storefront.zip** and **store.config.json**.
- [ ] `/stores` lists the store with its price and `0 orders`; its **Storefront files** link opens
      a page where the saved config is on file and the zip can be **re-downloaded** (configs are
      saved automatically at launch). Edit the description there, re-download, and confirm the
      change is in the zip's `store.config.json`.
- [ ] Recovery path: for a store with **no** saved config (e.g. launched before this feature),
      the same page rebuilds it — the form must match the on-chain commitment exactly, and the
      match/mismatch indicator gates the download. Verify a deliberately wrong field shows the
      mismatch warning and disables the buttons.
- [ ] `/account`: update email works; **Delete account** signs you out; sign back in → store still listed (it's on-chain), onboarding asks for email again.

### 3. Storefront — buyer journey

```sh
unzip storefront.zip -d /tmp/mystore
python3 -m http.server 8080 -d /tmp/mystore
```

At `http://localhost:8080`, as the **buyer** account verify:

- [ ] Product name, description, image, and price render; "0 sold to date" appears (read from chain).
- [ ] Fill the form → invalid email is rejected client-side; required fields enforced.
- [ ] **Pay** → transaction popup for exactly the price → receipt shows order **№ 1**, PAID stamp, tx link, and a `?order=1` bookmark link.
- [ ] Open `?order=1` in a fresh tab — status shows **without** connecting a wallet.
- [ ] Switch MetaMask to another network → pay button becomes "Switch wallet to Anvil"; clicking it switches back.
- [ ] Tamper check: edit a field's `label` in `/tmp/mystore/store.config.json`, reload → red schema-mismatch warning, payment disabled. Revert it.

### 4. Fulfil / refund / withdraw (dashboard UI arrives in M4 — use cast)

```sh
STORE=<store address>
MERCHANT_PK=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80

cast send $STORE "setStatus(uint256,uint8)" 1 2 --rpc-url http://localhost:8545 --private-key $MERCHANT_PK
# → reload ?order=1: stamp reads FULFILLED

cast send $STORE "refund(uint256)" 1 --rpc-url http://localhost:8545 --private-key $MERCHANT_PK
# → buyer balance +price in MetaMask; stamp reads REFUNDED
```

Then place a second order as the buyer and:

```sh
cast send $STORE "withdraw()" --rpc-url http://localhost:8545 \
  --private-key 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
```

- [ ] Withdraw was sent by the **buyer's** key, but the **merchant** balance received the funds
      (withdraw always pays the immutable merchant — anyone may trigger it).

*Known gap:* decrypting an order blob in the browser is exercised only by the automated e2e
until the M4 dashboard ships its decrypt view.

---

## Troubleshooting (local anvil + MetaMask)

- **Stuck on "Confirm in your wallet…"** — MetaMask didn't raise its popup. Click the extension
  icon directly; the pending request is queued inside it.
- **Stuck on "Deploying…" / tx sent but never mined** — almost always a stale nonce after an
  anvil restart: MetaMask remembers the old chain's transaction count and submits a gapped
  nonce, which anvil queues forever. Fix: MetaMask → Settings → Advanced → **Clear activity tab
  data** (with the Anvil network selected), retry. Do this after **every** anvil restart. The
  app now times out after 2 minutes with this hint instead of hanging.
- **`eth_call … execution reverted` noise in the anvil log** for selectors `0x95d89b41`
  (symbol), `0x313ce567` (decimals), `0x70a08231` (balanceOf) — that's MetaMask probing the
  transaction target to see if it's an ERC-20 so it can prettify the confirmation. The factory
  and stores aren't tokens, so the probes revert. Harmless; ignore.
- **Anvil not running / wrong port** — the launcher and storefront default to
  `http://127.0.0.1:8545`; a dead RPC shows as "could not read the factory contract" (launcher)
  or the RPC warning banner (storefront).

---

## Part 2 — Sepolia (the real definition-of-done; needs your keys)

Prereqs: funded Sepolia deployer key, `SEPOLIA_RPC_URL`, `ETHERSCAN_API_KEY`.

1. Deploy + verify the factory per `contracts/README.md` (`forge script script/Deploy.s.sol
   --rpc-url sepolia --broadcast --verify …`).
- [ ] Factory and a test store show the **green verified check** on Sepolia Etherscan.
2. Rebuild the launcher with Sepolia baked in (`NEXT_PUBLIC_*` values are build-time):
   ```sh
   NEXT_PUBLIC_CHAIN_ID=11155111 \
   NEXT_PUBLIC_FACTORY_ADDRESS=<factory> \
   NEXT_PUBLIC_USDC_ADDRESS=0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238 \
   pnpm build && pnpm start
   ```
3. Repeat Part 1 steps 2–4 on Sepolia with a real (test-fund-only) wallet.
- [ ] **USDC store path** (impossible on plain anvil): create a USDC store; buyer checkout shows
      the two-step notice and pops **approve** then **pay**; refund returns USDC.
- [ ] Explorer links on storefront receipts and launcher pages resolve to Sepolia Etherscan.
