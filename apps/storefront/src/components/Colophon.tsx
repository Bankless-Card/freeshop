import type { Chain } from "viem";
import type { StoreConfig } from "@freeshop/shared";
import { explorerAddressUrl } from "../lib/chain";

export function Colophon({ config, chain }: { config: StoreConfig; chain: Chain }) {
  const url = explorerAddressUrl(chain, config.storeAddress);
  return (
    <footer className="colophon">
      <span>
        escrow contract:{" "}
        {url ? (
          <a href={url} target="_blank" rel="noreferrer">
            {config.storeAddress}
          </a>
        ) : (
          config.storeAddress
        )}
      </span>
      <span>self-hosted · no backend · settled on {chain.name}</span>
    </footer>
  );
}
