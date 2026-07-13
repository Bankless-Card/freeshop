# Contracts

Per-product escrow contracts for the decentralized storefront launcher.

- **`StorefrontFactory`** — platform-deployed once. Charges the launch fee (owner-adjustable, default 0.005 ETH; `msg.value` must match it exactly so a stale client can't overpay after a fee change), forwards it to the treasury, validates the payment asset (native ETH sentinel `address(0)` or an allowlisted ERC-20), deploys `StoreEscrow`s, and keeps the on-chain merchant → stores registry.
- **`StoreEscrow`** — one per product. Immutable constructor-set config (merchant, payment asset, price, merchant x25519 pubkey, fulfillment-schema hash). `pay()` emits the buyer's encrypted fulfillment blob as event data (never storage). Merchant-only `setStatus`/`refund`; `withdraw()` is callable by anyone but always pays the immutable merchant. ETH refunds push to the buyer and fall back to a claimable credit if the push reverts; the withdrawable balance always excludes unclaimed refund credits.

## Develop

```sh
forge build
forge test            # unit + fuzz + invariant suites
forge coverage --no-match-coverage "(test|script)"
```

Static analysis (both expected clean; triage notes in ../TASKS.md):

```sh
slither . --filter-paths "lib/|test/|script/"
aderyn .              # writes report.md; requires evm_version aderyn understands, see TASKS.md
```

## Local smoke test (full lifecycle)

```sh
anvil &
forge script script/Smoke.s.sol --rpc-url http://localhost:8545 --broadcast \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

Deploys factory + ETH store, pays twice, fulfills one order, refunds the other, withdraws. The
private key above is anvil's well-known dev account #0 — never use it anywhere real.

## Sepolia deploy

Needs a funded deployer key plus RPC and Etherscan API keys:

```sh
export SEPOLIA_RPC_URL=...
export ETHERSCAN_API_KEY=...
export TREASURY=0x...        # optional, defaults to deployer
export LAUNCH_FEE=5000000000000000  # optional, defaults to 0.005 ether

forge script script/Deploy.s.sol --rpc-url sepolia --broadcast --verify \
  --private-key $DEPLOYER_KEY
```

Sepolia USDC (`0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`) is allowlisted by the script.

## Changing the launch fee (e.g. a promotion)

`setLaunchFee` is `onlyOwner`, takes effect immediately for future deploys only, and emits
`LaunchFeeChanged`. The launcher UI reads the fee from the chain (at page load and again right
before submitting), so no frontend deploy is needed.

```sh
# start promo: 0.001 ETH
cast send $FACTORY "setLaunchFee(uint256)" 1000000000000000 --rpc-url $RPC --ledger

# verify
cast call $FACTORY "launchFee()(uint256)" --rpc-url $RPC

# end promo: back to 0.005 ETH
cast send $FACTORY "setLaunchFee(uint256)" 5000000000000000 --rpc-url $RPC --ledger
```

Use `--private-key $OWNER_KEY` instead of `--ledger` if the owner is a raw key (testnet only).
Mainnet notes:

- The owner key is the real exposure — whoever holds it can zero the fee or redirect the
  treasury for future deploys (it can never touch existing stores or their funds). Keep it on a
  hardware wallet or multisig.
- `deployStore` requires `msg.value == launchFee` exactly, so a deploy submitted with a stale
  fee reverts rather than overpaying — safe to change the fee at any time; only deploys already
  in flight when the change lands can revert.
- Monitor `LaunchFeeChanged` events to catch unexpected changes.

## ABI export

After `forge build`, refresh the shared ABIs used by the launcher/storefront:

```sh
node ../packages/shared/scripts/export-abis.mjs
```
