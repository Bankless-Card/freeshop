import "@fontsource/fraunces/600.css";
import "@fontsource/fraunces/900.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";

import { createPublicClient, http } from "viem";
import { hashFulfillmentSchema, parseStoreConfig, storeEscrowAbi } from "@freeshop/shared";
import { resolveChain } from "./lib/chain";
import { initCheckout, type StoreFacts } from "./lib/checkout";
import { byId, setSlot, show } from "./lib/dom";
import { formatAmount, truncateAddress } from "./lib/format";
import { initRefundBanner } from "./lib/refund";
import { renderContractLink, renderStatic } from "./lib/render";
import { initStatusLookup } from "./lib/status";
import * as wallet from "./lib/wallet";

function initWalletButton(): void {
  const button = byId<HTMLButtonElement>("wallet-btn");
  if (!button) return;
  show(button);

  wallet.onWalletChange(({ address }) => {
    if (!wallet.hasWallet()) {
      button.textContent = "No wallet found";
      button.disabled = true;
    } else if (address) {
      button.textContent = `${truncateAddress(address)} · disconnect`;
      button.title = address;
      button.disabled = false;
    } else {
      button.textContent = "Connect wallet";
      button.title = "";
      button.disabled = false;
    }
  });

  button.addEventListener("click", () => {
    if (wallet.getWallet().address) wallet.disconnect();
    else void wallet.connect().catch(() => {});
  });
}

async function boot(): Promise<void> {
  // Runtime-fetched so merchants can edit the config on their host without rebuilding.
  const response = await fetch(`${import.meta.env.BASE_URL}store.config.json`, { cache: "no-cache" });
  if (!response.ok) throw new Error(`could not load store.config.json (HTTP ${response.status})`);
  const config = parseStoreConfig(await response.json());
  const chain = resolveChain(config);
  const publicClient = createPublicClient({ chain, transport: http(config.rpcUrl) });

  renderStatic(config, chain.name);
  renderContractLink(config, chain);
  byId("boot")?.remove();
  show(byId("store"));

  await wallet.initWallet(chain);
  initWalletButton();

  // Live facts from the contract — authoritative over the config copies.
  let facts: StoreFacts | undefined;
  let blocked = false;

  initCheckout({
    config,
    chain,
    publicClient,
    getFacts: () => facts,
    isBlocked: () => blocked,
  });
  initStatusLookup(config, publicClient, chain);
  initRefundBanner(config, publicClient, chain);

  const contract = { address: config.storeAddress, abi: storeEscrowAbi } as const;
  try {
    const [price, paymentToken, merchantPubKey, schemaHash, orderCount] = await Promise.all([
      publicClient.readContract({ ...contract, functionName: "price" }),
      publicClient.readContract({ ...contract, functionName: "paymentToken" }),
      publicClient.readContract({ ...contract, functionName: "merchantPubKey" }),
      publicClient.readContract({ ...contract, functionName: "fulfillmentSchemaHash" }),
      publicClient.readContract({ ...contract, functionName: "orderCount" }),
    ]);
    facts = { price, paymentToken, merchantPubKey };
    setSlot("price", formatAmount(price, config.payment.decimals, config.payment.symbol));
    setSlot("sold-count", `${orderCount} sold to date`);

    if (hashFulfillmentSchema(config.fulfillment.fields) !== schemaHash) {
      blocked = true;
      show(byId("schema-warning"));
    }
  } catch {
    blocked = true;
    show(byId("rpc-warning"));
  }
  document.dispatchEvent(new Event("freeshop:facts"));
}

boot().catch((error) => {
  const boot = byId("boot");
  if (boot) {
    boot.classList.add("boot--error");
    boot.textContent =
      "THIS SHOP FAILED TO LOAD\n\n" +
      (error instanceof Error ? error.message : String(error)) +
      "\n\nIf you are the merchant: check store.config.json.";
  }
});
