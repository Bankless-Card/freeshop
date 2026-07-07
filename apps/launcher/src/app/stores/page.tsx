"use client";

import Link from "next/link";
import { formatUnits } from "viem";
import { useReadContract, useReadContracts } from "wagmi";
import { ETH_SENTINEL, storeEscrowAbi, storefrontFactoryAbi } from "@freeshop/shared";
import { AnalyticsPanel } from "@/components/Analytics";
import { launcherChain } from "@/lib/chains";
import { publicEnv } from "@/lib/env";
import { useAuth } from "@/lib/useAuth";
import { useMerchantAnalytics } from "@/lib/useIndexer";

export default function Stores() {
  const { me } = useAuth();
  const chain = launcherChain();
  const explorer = chain.blockExplorers?.default?.url;
  const analytics = useMerchantAnalytics(me.data?.address);

  const { data: stores, isPending } = useReadContract({
    address: publicEnv.factoryAddress,
    abi: storefrontFactoryAbi,
    functionName: "getStores",
    args: me.data?.address ? [me.data.address] : undefined,
    query: { enabled: !!me.data?.address && !!publicEnv.factoryAddress },
  });

  const { data: facts } = useReadContracts({
    allowFailure: false,
    contracts: (stores ?? []).flatMap((store) => [
      { address: store, abi: storeEscrowAbi, functionName: "price" } as const,
      { address: store, abi: storeEscrowAbi, functionName: "paymentToken" } as const,
      { address: store, abi: storeEscrowAbi, functionName: "orderCount" } as const,
    ]),
    query: { enabled: !!stores && stores.length > 0 },
  });

  if (me.isPending) return <div className="boot">LOADING…</div>;
  if (!me.data?.authenticated) {
    return (
      <div className="boot">
        NOT SIGNED IN — <a href="/">go to sign-in</a>
      </div>
    );
  }

  return (
    <section className="reveal">
      <h1 className="section-title" style={{ marginTop: 40 }}>
        <span className="index">STORES</span> All stores, one ledger
      </h1>
      <p style={{ fontSize: 14.5, maxWidth: "56ch" }}>
        The store list is read straight from the factory contract — it belongs to your wallet,
        not to us. Unique customers are counted across your whole store set (the same wallet
        buying at two stores counts once).
      </p>

      {analytics.isError ? (
        <div className="error-box">Analytics unavailable — is the indexer running? ({analytics.error.message})</div>
      ) : analytics.data ? (
        <div className="card card--flat" style={{ marginTop: 8 }}>
          <AnalyticsPanel rollup={analytics.data.aggregate} />
        </div>
      ) : null}

      {isPending && <div className="boot">READING FACTORY…</div>}
      {stores && stores.length === 0 && (
        <div className="card card--flat">
          No stores yet. <Link href="/new">Launch your first</Link> — it takes about two minutes.
        </div>
      )}

      {stores?.map((store, i) => {
        const price = facts?.[i * 3] as bigint | undefined;
        const token = facts?.[i * 3 + 1] as `0x${string}` | undefined;
        const orders = facts?.[i * 3 + 2] as bigint | undefined;
        const isEth = token === ETH_SENTINEL;
        return (
          <div className="store-row" key={store}>
            <span>
              {explorer ? (
                <a href={`${explorer}/address/${store}`} target="_blank" rel="noreferrer">
                  {store}
                </a>
              ) : (
                store
              )}
            </span>
            <span>
              {price !== undefined && token !== undefined
                ? `${formatUnits(price, isEth ? 18 : 6)} ${isEth ? "ETH" : "USDC"} · ${orders ?? 0} orders`
                : "…"}
              {"  "}
              <Link href={`/stores/${store}`} className="btn btn--ghost" style={{ marginLeft: 12 }}>
                Storefront files
              </Link>
            </span>
          </div>
        );
      })}
    </section>
  );
}
