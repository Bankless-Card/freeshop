import { createPublicClient, defineChain, http, type Chain, type PublicClient } from "viem";
import { anvil, mainnet, sepolia } from "viem/chains";
import { publicEnv } from "./env";

const KNOWN_CHAINS: Chain[] = [mainnet, sepolia, anvil];

/** The single chain this Launcher deployment targets (per-chain deploys, like the PRD's v1 L1 scope). */
export function launcherChain(): Chain {
  const known = KNOWN_CHAINS.find((c) => c.id === publicEnv.chainId);
  if (known) return known;
  if (!publicEnv.rpcUrl) {
    throw new Error(`chainId ${publicEnv.chainId} is not built in — set NEXT_PUBLIC_RPC_URL`);
  }
  return defineChain({
    id: publicEnv.chainId,
    name: `Chain ${publicEnv.chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [publicEnv.rpcUrl] } },
  });
}

/** Server-side client (SIWE verification, reads). */
export function serverPublicClient(): PublicClient {
  const chain = launcherChain();
  return createPublicClient({ chain, transport: http(publicEnv.rpcUrl) });
}
