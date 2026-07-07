# freeshop — decentralized storefront launcher

Infrastructure that lets a solo merchant sell online for crypto with no backend of their own:

- **`contracts/`** — Foundry project: `StorefrontFactory` (platform-deployed, charges the launch
  fee, registry of merchant stores) and `StoreEscrow` (one per product: payment, on-chain order
  status, encrypted fulfillment blobs emitted in the pay tx, merchant refunds/withdrawals).
- **`apps/storefront/`** — static, self-hostable storefront template (zero backend): product page,
  wallet connect, in-browser encryption of order details, pay/status/claim-refund flows.
- **`apps/launcher/`** — the platform web app (the only component with a backend): SIWE auth,
  merchant accounts, store deployment wizard, storefront package generation, and the merchant
  dashboard (analytics, orders with in-browser decryption, fulfil/refund/withdraw).
- **`apps/indexer/`** — Ponder indexer over the factory + all deployed stores; serves the
  read-only analytics API the dashboard uses. Derived state, rebuildable from chain.
- **`packages/shared/`** — contract ABIs, config schemas, and crypto helpers shared across apps.

Execution state and per-milestone checklists live in [TASKS.md](TASKS.md).

## Quick start

```sh
pnpm contracts:build     # forge build
pnpm contracts:test      # forge test (58 tests)
pnpm --filter @freeshop/shared test        # crypto/config units + anvil e2e
pnpm --filter @freeshop/storefront build   # static storefront in apps/storefront/dist
pnpm --filter @freeshop/storefront dev     # storefront dev server
```

Node >= 22.12 (see `.nvmrc`), pnpm, and Foundry are required.

See [contracts/README.md](contracts/README.md) for deploy/smoke-test instructions.
