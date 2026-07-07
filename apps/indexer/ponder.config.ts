import { createConfig, factory } from "ponder";
import { getAbiItem } from "viem";
import { storeEscrowAbi, storefrontFactoryAbi } from "@freeshop/shared";

/**
 * Indexes the factory plus every StoreEscrow it deploys (factory pattern — new stores are
 * picked up automatically from StoreDeployed events). All tables are derived state that can
 * always be rebuilt from chain; the chain, not this database, is the source of truth.
 */

const chainId = Number(process.env.INDEXER_CHAIN_ID ?? 31337);
const rpc = process.env.INDEXER_RPC_URL ?? "http://127.0.0.1:8545";
const factoryAddress = (process.env.FACTORY_ADDRESS ?? "") as `0x${string}`;
const startBlock = Number(process.env.START_BLOCK ?? 0);

if (!factoryAddress) throw new Error("FACTORY_ADDRESS is required");

export default createConfig({
  chains: {
    target: { id: chainId, rpc },
  },
  contracts: {
    StorefrontFactory: {
      chain: "target",
      abi: storefrontFactoryAbi,
      address: factoryAddress,
      startBlock,
    },
    StoreEscrow: {
      chain: "target",
      abi: storeEscrowAbi,
      address: factory({
        address: factoryAddress,
        event: getAbiItem({ abi: storefrontFactoryAbi, name: "StoreDeployed" }),
        parameter: "store",
      }),
      startBlock,
    },
  },
});
