import type { Chain } from "viem";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import type { StoreConfig } from "@freeshop/shared";
import { truncateAddress } from "../lib/format";

export function Masthead({ config, chain }: { config: StoreConfig; chain: Chain }) {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();

  return (
    <header className="masthead">
      <div className="masthead__brand">
        <span className="eyebrow">Escrow storefront</span>
        <span className="masthead__chain">
          {chain.name} · {truncateAddress(config.storeAddress)}
        </span>
      </div>
      {isConnected && address ? (
        <button type="button" className="btn btn--ghost" onClick={() => disconnect()} title={address}>
          {truncateAddress(address)} · disconnect
        </button>
      ) : (
        <button
          type="button"
          className="btn"
          disabled={isPending || connectors.length === 0}
          onClick={() => connect({ connector: connectors[0] })}
        >
          {connectors.length === 0 ? "No wallet found" : isPending ? "Connecting…" : "Connect wallet"}
        </button>
      )}
    </header>
  );
}
