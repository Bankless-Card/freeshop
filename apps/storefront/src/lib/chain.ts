import { defineChain, type Chain } from "viem";
import { anvil, mainnet, sepolia } from "viem/chains";
import type { StoreConfig } from "@freeshop/shared";

const KNOWN_CHAINS: Chain[] = [mainnet, sepolia, anvil];

/** Resolves the chain for this store; unknown chain ids need an rpcUrl in the config. */
export function resolveChain(config: StoreConfig): Chain {
  const known = KNOWN_CHAINS.find((c) => c.id === config.chainId);
  if (known) return known;
  if (!config.rpcUrl) {
    throw new Error(`chainId ${config.chainId} is not built in — set "rpcUrl" in store.config.json`);
  }
  return defineChain({
    id: config.chainId,
    name: `Chain ${config.chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [config.rpcUrl] } },
  });
}

export function explorerAddressUrl(chain: Chain, address: string): string | undefined {
  const base = chain.blockExplorers?.default?.url;
  return base ? `${base}/address/${address}` : undefined;
}

export function explorerTxUrl(chain: Chain, hash: string): string | undefined {
  const base = chain.blockExplorers?.default?.url;
  return base ? `${base}/tx/${hash}` : undefined;
}
