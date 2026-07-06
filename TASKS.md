# Project Tasks — Decentralized Storefront Launcher (v1)

Living state tracker. Update as work lands. Source of truth for scope is the PRD (v1.3);
this file tracks *execution* state per milestone.

## M1 — Contracts (code complete 2026-07-06; Sepolia deploy pending owner keys)

- [x] Toolchain: Foundry installed (1.7.1), OpenZeppelin v5.6.1, forge-std
- [x] Monorepo scaffold: git init, pnpm workspace, `contracts/` Foundry project, foundry.toml, remappings
- [x] `StoreEscrow.sol` — pay / setStatus / refund (push-with-pull-fallback) / claimRefund / withdraw; immutable merchant, paymentToken (address(0)=ETH), price, merchantPubKey (x25519), fulfillmentSchemaHash
- [x] `StorefrontFactory.sol` — deployStore (payable, fee → treasury), on-chain merchant→stores registry, owner-updatable launchFee/treasury/token allowlist
- [x] Unit tests: both asset paths (ETH + MockUSDC), status transitions, access control, fee handling, whitelist, refund edge cases, hostile-recipient fallback, withdraw accounting — 55 unit tests
- [x] Fuzz + invariant tests: balance ≥ totalRefundLiability; funds conservation (in = out + held); legal statuses only — 58 tests total, **100% line/statement/branch/function coverage** on both contracts
- [x] Event assertions on every state change
- [x] Static analysis: Slither 0.11.5 **clean (0 findings)** after triage; Aderyn 0.1.9 run, findings triaged (below)
- [x] Deploy scripts: `script/Deploy.s.sol` (factory + Sepolia USDC allowlist + Etherscan verify) and `script/Smoke.s.sol` (full lifecycle: deploy store → pay → fulfil → pay → refund → withdraw) — smoke **passed on local anvil**
- [x] ABI export into `packages/shared/abis/` (`node packages/shared/scripts/export-abis.mjs`)
- [x] READMEs (root + contracts), `.env.example`

### M1 open items
- **Sepolia deploy + verification** requires a funded deployer key and `SEPOLIA_RPC_URL`/`ETHERSCAN_API_KEY` from the owner. Script is ready; command documented in `contracts/README.md`.
- **Static-analysis triage (accepted findings):**
  - Slither reentrancy-eth/benign in `refund()` — the pull-fallback credit necessarily writes after the push call; all mutating entry points share the reentrancy guard. Annotated inline with `slither-disable`; Slither reports 0 results.
  - Aderyn H-1 "uninitialized state variable" (`orderCount`) — false positive, implicit zero is intended. H-2 "factory locks Ether" — false positive, `deployStore` forwards full msg.value to treasury in the same call and the factory has no receive/fallback. L-1 centralization (owner-set fee/treasury/allowlist) — by design per PRD. L-3 unindexed event fields — deliberate; `encryptedFulfillment` must stay non-indexed (indexing a `bytes` field stores only its hash, destroying the payload). L-5 PUSH0 — v1 is L1-only; revisit for v2 L2 work.
  - Aderyn note: cargo-installed 0.1.9 is old; it can't parse `evm_version = "osaka"` (OZ's vendored foundry.toml sets it — patch it temporarily to run, see git history). The official `cyfrinup` installer was blocked in this environment. Re-run a current Aderyn during M5 hardening.
- `evm_version` pinned to `cancun` (universally supported incl. tooling; nothing needs post-cancun opcodes).
- Encryption scheme decision (settled with owner 2026-07-06): **signature-derived x25519 NaCl box**, not ECIES — browser wallets can't decrypt ECIES to the wallet key and MetaMask `eth_decrypt` is deprecated. Contract stores a `bytes32` x25519 pubkey. Payload format: `version byte ‖ ephemeral pubkey ‖ nonce ‖ ciphertext` (version byte keeps the v2 CID option open).
- Refund mechanism is push-with-pull-fallback (refinement of PRD's "pull-payment refunds": same DoS-safety, better buyer UX). Flagged in plan; revisit at audit if the auditor prefers strict pull.

## M2 — Storefront template (not started)

`apps/storefront/` — Vite + React + TS + wagmi/viem + tweetnacl. Fully static, zero backend, no secrets.

- [ ] Runtime-fetched `store.config.json`; finalize schema (JSON Schema in `packages/shared`): chainId, contract address, ABI version pointer, payment token, price, product metadata, fulfillment schema
- [ ] Product page rendered from config
- [ ] Wallet connect (wagmi)
- [ ] Fulfillment form generated from merchant's schema (required/optional fields)
- [ ] Client-side encryption to merchant x25519 pubkey (payload format from M1)
- [ ] Pay flow: ETH value call; USDC approve + pay
- [ ] Order confirmation + status lookup (read contract by orderId / connected wallet)
- [ ] Claim-refund action (for failed-push refunds)
- [ ] Loading/degraded states for slow RPC
- [ ] GH Pages / Cloudflare Pages deploy workflow; "use this template" readiness (extract to public repo at release)

Definition of done: a customer can open the static site, connect, pay in the store's single asset, submit encrypted fulfillment (emitted in the pay tx), and check status — against a testnet store.

## M3 — Launcher backend + deploy flow (not started)

`apps/launcher/` — Next.js App Router; backend allowed (Launcher only, never Storefront).

- [ ] SIWE auth (connected address = merchant identity)
- [ ] Postgres (Drizzle): merchant accounts only — wallet address ↔ required-but-unverified email; email update; delete capability (backend PII note §6.1)
- [ ] Product creation form: name/description/images, price, single payment asset (ETH or USDC), fulfillment-schema builder
- [ ] Merchant key ceremony: personal_sign fixed domain message → derive x25519 keypair → pubkey into deploy params; loss/re-derivation UX + warnings
- [ ] Deploy flow: cost estimate (gas + 0.01 ETH fee) → factory `deployStore` from merchant wallet
- [ ] Storefront package generation: pre-filled `store.config.json`, zip download, template-repo link
- [ ] Compliance + privacy disclosures at onboarding (merchant responsibility; ciphertext permanence)

Definition of done: merchant connects, gives email, defines product + schema, pays fee, gets deployed contract + downloadable configured storefront.

## M4 — Dashboard + indexer (not started)

- [ ] Ponder indexer (Postgres-backed, in Launcher backend): `StoreDeployed`, `OrderPlaced`, `StatusChanged`, `Refunded`, `RefundClaimed`, `Withdrawn`; treat as rebuildable derived state
- [ ] Stores list from factory registry
- [ ] Aggregate analytics across all merchant stores — unique customers deduped by wallet across stores (not summed per-store)
- [ ] Per-store analytics: sales count, sales over time, refunds, unique customers
- [ ] Orders table: status, buyer, amount, timestamp, encrypted blob + client-side decrypt (re-sign → re-derive key; plaintext never leaves browser)
- [ ] Order management: on-chain setStatus, refund
- [ ] Per-store withdraw with withdrawable balance + outstanding-unfulfilled-orders warning

Definition of done: PRD §9 dashboard bullets all demonstrable on testnet.

## M5 — Hardening (not started; mostly human tasks)

- [ ] Independent audit (candidate firms per PRD: OpenZeppelin, Trail of Bits, Sherlock, Cyfrin, Spearbit — owner selects/contracts)
- [ ] Address audit findings; re-run Slither/Aderyn
- [ ] Testnet dry-runs with small real amounts, end to end
- [ ] Mainnet deploy of factory; Etherscan verification (green check)
- [ ] Storefront template extracted to public template repo

## v2 backlog / out of scope for v1 — do not build

Clone-proxy (EIP-1167) store deployment (requires `initialize()` rework + fresh audit, PRD §6.8) · multi-SKU · stock/inventory limits · partial refunds · payout-address rotation · batch `withdrawAll` multicall · paid notification/monitoring service (+ email verification) · order-status soulbound NFT · L2 deployment (flag per-order L1 cost to owner before real sales — PRD §6.6) · off-chain/IPFS fulfillment storage (only if EU service required) · dispute resolution.
