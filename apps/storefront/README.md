# Your storefront

A fully static, self-hosted storefront for one product, paid for in crypto and settled by your
own escrow contract. **No backend, no database, no secrets** — it can be hosted anywhere static
files can, for free.

- Product details come from `public/store.config.json` (the Launcher pre-fills it; edit copy and
  images freely).
- Live facts — price, payment asset, your encryption key — are read from your contract; the
  config copies exist only for instant first paint.
- Buyers' order details (email, shipping address, …) are **encrypted in their browser** with your
  public key and ride along inside the payment transaction. Only you can read them, from your
  dashboard. No server is involved, including ours.

## Edit your store

Everything a merchant normally touches is in `public/`:

| File | What it is |
| --- | --- |
| `public/store.config.json` | Product name, description, price display, form fields |
| `public/product.svg` | Replace with your product photo (update `product.images` to match) |

The config format is documented by `store-config.schema.json` in `@freeshop/shared`.

## Run locally

```sh
pnpm install
pnpm dev        # local dev server
pnpm build      # static site in dist/
pnpm preview    # serve the built site
```

## Deploy for free

**GitHub Pages** — push this repo to GitHub, then Settings → Pages → Source: *GitHub Actions*.
The included workflow (`.github/workflows/deploy-pages.yml`) builds and publishes on every push
to `main`.

**Cloudflare Pages** — create a Pages project from this repo with build command `pnpm build` and
output directory `dist`.

Any other static host works the same way: upload `dist/`.

## Trust properties (what buyers can verify)

- The page shows the escrow contract address; buyers can inspect its verified source on a block
  explorer.
- The checkout form is hashed and committed on-chain at deploy; if this site's form ever
  disagrees with that commitment, the storefront shows a warning instead of the pay button.
- Payments go to the contract, not to us and not to a server. Refunds and withdrawals are
  contract calls the merchant makes directly.
