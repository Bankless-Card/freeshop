import type { Chain } from "viem";
import type { StoreConfig } from "@freeshop/shared";
import { explorerAddressUrl } from "./chain";
import { setSlot, slot } from "./dom";
import { formatAmount, truncateAddress } from "./format";

/** Fills every config-driven slot in the static markup. */
export function renderStatic(config: StoreConfig, chainName: string): void {
  document.title = config.product.name;
  setSlot("chain-line", `${chainName} · ${truncateAddress(config.storeAddress)}`);
  setSlot("product-name", config.product.name);
  setSlot("product-description", config.product.description);
  setSlot("price", formatAmount(BigInt(config.payment.price), config.payment.decimals, config.payment.symbol));
  setSlot("colophon-note", `self-hosted · no backend · settled on ${chainName}`);

  const image = slot<HTMLImageElement>("product-image");
  const figure = slot<HTMLElement>("product-figure");
  if (config.product.images[0]) {
    if (image) {
      image.src = config.product.images[0];
      image.alt = config.product.name;
    }
  } else if (figure) {
    figure.hidden = true;
  }
}

export function renderContractLink(config: StoreConfig, chain: Chain): void {
  const link = slot<HTMLAnchorElement>("contract-link");
  if (!link) return;
  link.textContent = config.storeAddress;
  const url = explorerAddressUrl(chain, config.storeAddress);
  if (url) link.href = url;
  else link.removeAttribute("href");
}
