# freeshop — smart-contract audit package

Prepared for prospective auditors (candidate firms: OpenZeppelin, Trail of Bits, Sherlock,
Cyfrin, Spearbit). Everything an auditor needs to scope and quote, in one document.

## 1. Scope

| | |
| --- | --- |
| Repository | freeshop monorepo (this repo), `contracts/` Foundry project |
| Commit | `e7f514436ef29a536f9e7890a29e908a958f5aec` (update to the audit-freeze commit) |
| Files in scope | `contracts/src/StoreEscrow.sol` (195 lines), `contracts/src/StorefrontFactory.sol` (94 lines) — **289 lines total** |
| Out of scope | tests, scripts, all TypeScript apps (launcher/storefront/indexer), off-chain encryption (context in §6) |
| Solidity | 0.8.30 (pinned), `evm_version = cancun`, optimizer 200 runs |
| Dependencies | OpenZeppelin Contracts v5.6.1 (`SafeERC20`, `ReentrancyGuard`, `Ownable`, `Address`), forge-std (tests only) |
| Target chain | Ethereum L1 (Sepolia first, then mainnet). L2s explicitly out of scope for v1 |
| Deployment | Full independent contracts via `new` in the factory — **no proxies, no clones, no upgradeability, no `selfdestruct`, no `delegatecall`** |

## 2. What the system is

A "decentralized Shopify": a platform-owned **StorefrontFactory** deploys per-product
**StoreEscrow** contracts for merchants, charging an owner-adjustable launch fee forwarded to a
treasury. Each StoreEscrow sells one product at a fixed price in a single asset (native ETH via
`address(0)` sentinel, or one allowlisted ERC-20 — USDC at launch). Buyers call `pay()` with an
encrypted fulfillment blob that is **emitted in the event, never stored**. Proceeds accrue in
the contract (escrow) so merchant-initiated full refunds stay payable; the merchant withdraws
via `withdraw()`, which **always pays the immutable `merchant` address regardless of caller**.

The platform is deliberately never in the money path: merchants can operate their store
(status updates, refunds, withdrawals) directly against the contract with no platform
involvement. There is no pause, no admin backdoor into stores, and no way for the factory owner
to affect an already-deployed store.

### Actors & trust model

| Actor | Powers | Trust assumption |
| --- | --- | --- |
| Factory owner (platform) | set `launchFee`, `treasury`, ERC-20 allowlist — affects **future deploys only** | Semi-trusted; must not be able to touch existing stores or their funds (please verify) |
| Merchant (per store) | `setStatus`, `refund`; receives `withdraw()` proceeds | Trusted for their own store only; can rug their own buyers by never fulfilling (accepted — see §5) |
| Buyer | `pay`, `claimRefund` | Untrusted; may be a hostile contract |
| Anyone | `withdraw()` (pays merchant), sending ETH to an ETH-store's `receive()` | Untrusted |

## 3. Core protocol properties to verify

These are the properties the design intends and the test suite enforces; breaking any of them
is a valid finding:

1. **Funds only ever flow to the merchant or to an order's recorded buyer.** No caller,
   including the factory owner, can redirect them.
2. **Refund liability is always backed:** `contract balance ≥ totalRefundLiability` at all
   times; `withdraw()` pays `balance − totalRefundLiability`, so unclaimed (queued) buyer
   refunds can never be swept by the merchant.
3. **Order status transitions are closed:** `NONE→PAID` (pay), `PAID→{FULFILLED, CANCELLED}`
   (merchant), `{PAID, FULFILLED, CANCELLED}→REFUNDED` (merchant refund, any time, full amount
   only), `REFUNDED` terminal. Statuses are set nowhere else.
4. **Per-store config is immutable:** merchant, paymentToken, price, merchantPubKey,
   fulfillmentSchemaHash are constructor-set with no setters.
5. **Exact payment:** ETH stores require `msg.value == price`; ERC-20 stores require
   `msg.value == 0` and measure the received balance delta `== price` (rejects fee-on-transfer
   even if mis-allowlisted).
6. **A hostile buyer cannot brick anything:** a reverting/reentrant recipient degrades their
   ETH refund to a pull-claim (`pendingRefunds` / `claimRefund`) and affects no other order.
7. **Factory fee handling:** `deployStore` requires `msg.value == launchFee` (exact match, so a
   caller holding a stale fee reverts instead of overpaying after a fee change) and forwards it
   to the treasury atomically; the factory never accrues a balance (it has no receive/fallback).
8. **Event completeness:** every state change emits an event; the off-chain system (indexer,
   dashboards) is reconstructed entirely from events, so missing/wrong events are findings too.

## 4. Known design decisions (deliberate — challenge them, but they are not oversights)

- **Push-with-pull-fallback ETH refunds.** `refund()` attempts a direct send with full gas
  forwarding; on failure it credits `pendingRefunds[buyer]` for `claimRefund()`. CEI is
  followed (status set before the call) and every mutating entry point shares the reentrancy
  guard. ERC-20 refunds are plain `safeTransfer` (no recipient hooks on allowlisted tokens).
- **`withdraw()` is callable by anyone** and pays only the immutable merchant. This
  intentionally leaves room for a future batched multi-store sweep contract without changing
  StoreEscrow.
- **Immutable `merchant`** (no payout rotation) and **one product per contract** — v1 product
  decisions; fewer money-moving functions to audit.
- **ERC-20 allowlist at the factory** (USDC at launch) is the primary defense against
  misbehaving tokens; the escrow's balance-delta check is defense in depth. Reentrant-callback
  tokens (ERC-777-style) are expected to be excluded by the allowlist *and* blocked by the
  reentrancy guard.
- **Unlimited supply, no stock, no partial refunds, no dispute layer** — v1 scope decisions.
- **ETH-store `receive()` accepts plain ETH** so a merchant can top the contract back up to
  cover refunds after withdrawing; ERC-20 stores reject ETH so none can get stuck. Note: ERC-20
  accidentally sent to any store is unrecoverable (accepted; no sweep function by design — a
  sweep would be a new money-moving path).
- **Merchant can refund after FULFILLED, forever** — explicit product requirement.
- **A merchant who withdraws with unfulfilled orders can end up unable to refund**
  (`InsufficientEscrowBalance`) until they top back up. Accepted; surfaced in the dashboard UI.

## 5. Accepted risks (not findings unless you can escalate them)

- Merchant rug: buyers pay, merchant never fulfills; refunds are merchant-initiated only.
  Mitigation is reputational, out of protocol.
- Factory owner can set an arbitrary future `launchFee`/allowlist entry — affects only new
  deploys; a malicious allowlist entry affects only merchants who *choose* that token
  (though see §3.5 defense in depth).
- Encrypted PII permanence on-chain (see §6) — product-accepted; no EU targeting in v1.

## 6. Off-chain crypto context (out of Solidity scope, in system scope)

Buyers encrypt fulfillment data in-browser to the merchant's x25519 public key
(`merchantPubKey`, bytes32 constructor param). The merchant's keypair is derived from
`keccak256` of an EIP-191 signature over a fixed message (`KEY_DERIVATION_MESSAGE` in
`packages/shared/src/crypto.ts` — must never change). Payload: `0x01 ‖ ephemeral pubkey(32) ‖
nonce(24) ‖ nacl.box ciphertext`, emitted in `OrderPlaced`. Known consideration: any site that
tricks a merchant into signing that exact message can read that merchant's order plaintext
(never funds). If the firm reviews off-chain crypto, this derivation and the payload format are
the interesting parts.

## 7. Existing assurance

- **58 Foundry tests** (unit + fuzz + 3 invariant suites with a randomized handler):
  `pnpm contracts:test`. **100% line/statement/branch/function coverage** on both in-scope
  files: `forge coverage --no-match-coverage "(test|script)"`.
- Invariants tested: balance ≥ liability; conservation (paid in + top-ups = refunded out +
  withdrawn + held); order-status legality.
- **Slither 0.11.5: 0 findings** (`slither . --filter-paths "lib/|test/|script/"`); inline
  `slither-disable` annotations each carry a justification comment.
- Aderyn run with triage notes in `TASKS.md` (M1 section).
- Full-stack e2e suites exercise the contracts through real wallets/indexer on anvil
  (`packages/shared/test/e2e-anvil.test.ts`, `apps/indexer/scripts/e2e-indexer.mjs`).

## 8. Suggested focus areas

1. `refund()` accounting and its interaction with `withdraw()`/`claimRefund()`
   (`totalRefundLiability` under weird interleavings, including top-ups via `receive()`).
2. Reentrancy surface of the ETH push in `refund()` (full gas forwarded, deliberate).
3. ERC-20 edge cases that survive an allowlist mistake (balance-delta check bypasses?).
4. Factory: fee under/overpayment, treasury reverting-receiver DoS on `deployStore`,
   registry growth (unbounded array per merchant — view-only consumer).
5. Event schema completeness/ordering (off-chain state is rebuilt purely from logs).

## 9. Reproduction

```sh
git checkout <audit-freeze-commit>
cd contracts
forge build && forge test && forge coverage --no-match-coverage "(test|script)"
slither . --filter-paths "lib/|test/|script/"
```
