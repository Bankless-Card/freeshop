# Testing procedure (M1–M4)

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
node scripts/e2e-api.mjs               # SIWE, email CRUD, store-config persistence, zip assertions

cd ../indexer
node scripts/e2e-indexer.mjs           # ponder over a seeded anvil: analytics incl. cross-store
                                       # unique-buyer dedup, statuses, blob decryption via API
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

You will end up with **three long-running terminals**: ① anvil (the chain), ② the indexer
(feeds the launcher's analytics/orders), ③ the launcher. Steps 1–3 below start them in that
order — the indexer needs the chain up, and the launcher's dashboard needs the indexer.

### 1. Chain + factory

```sh
# --state persists the chain across restarts (anvil is in-memory by default: without this,
# every restart erases all deployed stores, orders, and balances)
anvil --state ~/.freeshop-anvil-state.json              # terminal 1, leave running
# terminal 2:
cd ~/projects/freeshop/contracts
forge script script/Deploy.s.sol --rpc-url http://localhost:8545 --broadcast \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

Note the printed `StorefrontFactory:` address — steps 2 and 3 both need it.

### 2. Indexer

```sh
# terminal 2, leave running:
cd ~/projects/freeshop/apps/indexer
FACTORY_ADDRESS=<factory address> pnpm dev
```

Check its startup banner says `Live at http://localhost:42069`. Without the indexer the
launcher still starts, but every analytics/orders panel shows "indexer unreachable" — so run it
before the launcher. (It exits immediately if `FACTORY_ADDRESS` is missing; if you restart
anvil on a fresh chain, restart the indexer too and wipe `apps/indexer/.ponder/`.)

### 3. Launcher — merchant journey

```sh
# terminal 3, leave running:
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
- [ ] `/stores` lists the store with its price and `0 orders`; its **Manage store** link opens
      a page where the saved config is on file and the zip can be **re-downloaded** (configs are
      saved automatically at launch). Edit the description there, re-download, and confirm the
      change is in the zip's `store.config.json`.
- [ ] Recovery path: for a store with **no** saved config (e.g. launched before this feature),
      the same page rebuilds it — the form must match the on-chain commitment exactly, and the
      match/mismatch indicator gates the download. Verify a deliberately wrong field shows the
      mismatch warning and disables the buttons.
- [ ] `/account`: update email works; **Delete account** signs you out; sign back in → store still listed (it's on-chain), onboarding asks for email again.

### 4. Storefront — buyer journey

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

### 5. Dashboard (M4) — analytics, decrypt, manage

The indexer from step 2 powers everything here. In the launcher, as the **merchant**, verify:

- [ ] `/stores` shows the aggregate panel: sales, unique customers, refunds, awaiting fulfilment,
      gross·refunded revenue, and the 30-day bar chart (bars appear after your test purchases).
- [ ] The store detail page shows per-store analytics and the orders list with 🔒 locked details.
- [ ] **Unlock** → signature popup → order details decrypt in place and show the email/address
      you entered as the buyer. (Plaintext exists only in this tab; reload re-locks it.)
- [ ] **Mark fulfilled** on the order → tx popup → status badge flips to FULFILLED within ~15s
      (indexer refresh); the storefront's `?order=1` page shows FULFILLED too.
- [ ] Buy once more as the buyer, then **Refund** it from the dashboard → buyer balance goes up,
      badge flips to REFUNDED.
- [ ] **Withdraw** panel shows the correct withdrawable balance and the unfulfilled-orders
      warning when a PAID order exists; withdrawing pays the merchant address and zeroes the
      balance.
- [ ] Kill the indexer process → analytics/orders sections show "indexer unavailable" errors but
      store management (withdraw) and storefront files still work; restart it and they recover.

### 5b. Fulfil / refund / withdraw without the dashboard (self-sovereignty check — use cast)

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


---

## Troubleshooting (local anvil + MetaMask)

- **"My stores disappeared"** — anvil is an in-memory chain; stopping it erases everything
  (factory, stores, orders). Run it with `--state ~/.freeshop-anvil-state.json` so the chain
  survives restarts. If you do start a fresh chain: redeploy the factory, restart the indexer
  with the new `FACTORY_ADDRESS` (wipe `apps/indexer/.ponder/`), clear MetaMask activity data,
  and expect stale saved configs in the launcher for old store addresses. On Sepolia/mainnet
  this cannot happen — deployed stores are permanent.
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
- **Indexer loops `ExitStatus: Program terminated with exit(1)` with "Failed database query"
  retries** — the embedded PGlite database under `apps/indexer/.ponder/` is corrupted (e.g. a
  partial delete or an interrupted run). It is disposable derived state: stop the indexer,
  `rm -rf apps/indexer/.ponder`, start it again — it re-syncs everything from the chain.
- **Anvil not running / wrong port** — the launcher and storefront default to
  `http://127.0.0.1:8545`; a dead RPC shows as "could not read the factory contract" (launcher)
  or the RPC warning banner (storefront).
- **"indexer unreachable" in the dashboard** — the Ponder process isn't listening where the
  launcher expects (`PONDER_URL`, default `http://localhost:42069`). Checklist:
  1. Is it running? `cd apps/indexer && FACTORY_ADDRESS=<factory> pnpm dev`. Without
     `FACTORY_ADDRESS` it exits immediately with an error.
  2. Read its startup banner: if 42069 was busy, Ponder auto-increments (e.g. 42070) — either
     free the port (`lsof -nP -i :42069`) or set `PONDER_URL` in `apps/launcher/.env.local`.
  3. Anvil must be up *before* the indexer starts, and if you restarted anvil, restart the
     indexer too (wipe its `.ponder/` dir if it complains about a mismatched chain).
  4. Remember the local runbook is three processes: `anvil`, the indexer, and the launcher.

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
3. Repeat Part 1 steps 2–5 on Sepolia with a real (test-fund-only) wallet (indexer env:
   `INDEXER_CHAIN_ID=11155111`, `INDEXER_RPC_URL=$SEPOLIA_RPC_URL`, plus the factory's
   deploy block as `START_BLOCK` so it skips empty history).
- [ ] **USDC store path** (impossible on plain anvil): create a USDC store; buyer checkout shows
      the two-step notice and pops **approve** then **pay**; refund returns USDC.
- [ ] Explorer links on storefront receipts and launcher pages resolve to Sepolia Etherscan.
