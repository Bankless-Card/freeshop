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

  // The factory registry is the source of truth for "which stores are mine"...
  const { data: chainStores, isPending: chainPending } = useReadContract({
    address: publicEnv.factoryAddress,
    abi: storefrontFactoryAbi,
    functionName: "getStores",
    args: me.data?.address ? [me.data.address] : undefined,
    query: { enabled: !!me.data?.address && !!publicEnv.factoryAddress },
  });

  const { data: facts } = useReadContracts({
    allowFailure: true,
    contracts: (chainStores ?? []).flatMap((store) => [
      { address: store, abi: storeEscrowAbi, functionName: "price" } as const,
      { address: store, abi: storeEscrowAbi, functionName: "paymentToken" } as const,
      { address: store, abi: storeEscrowAbi, functionName: "orderCount" } as const,
    ]),
    query: { enabled: !!chainStores && chainStores.length > 0 },
  });

  if (me.isPending) return <div className="boot">LOADING…</div>;
  if (!me.data?.authenticated) {
    return (
      <div className="boot">
        NOT SIGNED IN — <a href="/">go to sign-in</a>
      </div>
    );
  }

  // ...but the list must never depend on a single source being up: merge the on-chain registry
  // with the indexer's store table (which also carries per-store stats).
  const indexed = analytics.data?.stores ?? [];
  const statsFor = (address: string) => indexed.find((s) => s.address.toLowerCase() === address.toLowerCase());
  const addresses: `0x${string}`[] = [...(chainStores ?? [])];
  for (const s of indexed) {
    if (!addresses.some((a) => a.toLowerCase() === s.address.toLowerCase())) addresses.push(s.address);
  }

  const chainUnavailable = !publicEnv.factoryAddress;
  const stillLoading = addresses.length === 0 && (chainPending || analytics.isPending) && !chainUnavailable;

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

      <h2 className="section-title" style={{ marginTop: 36 }}>
        <span className="index">LIST</span> Your stores
      </h2>

      {chainUnavailable && (
        <div className="error-box">NEXT_PUBLIC_FACTORY_ADDRESS is not configured — cannot read the on-chain registry.</div>
      )}
      {stillLoading && <p className="mono" style={{ fontSize: 13 }}>Reading factory registry…</p>}
      {!stillLoading && addresses.length === 0 && !chainUnavailable && (
        <div className="card card--flat">
          No stores yet. <Link href="/new">Launch your first</Link> — it takes about two minutes.
        </div>
      )}

      {addresses.map((store) => {
        const i = (chainStores ?? []).findIndex((a) => a.toLowerCase() === store.toLowerCase());
        const chainPrice = i >= 0 ? (facts?.[i * 3]?.result as bigint | undefined) : undefined;
        const chainToken = i >= 0 ? (facts?.[i * 3 + 1]?.result as `0x${string}` | undefined) : undefined;
        const chainOrders = i >= 0 ? (facts?.[i * 3 + 2]?.result as bigint | undefined) : undefined;
        const stats = statsFor(store);

        const token = chainToken ?? stats?.paymentToken;
        const price = chainPrice ?? (stats ? BigInt(stats.price) : undefined);
        const isEth = token === ETH_SENTINEL;
        const priceLabel =
          price !== undefined && token !== undefined
            ? `${formatUnits(price, isEth ? 18 : 6)} ${isEth ? "ETH" : "USDC"}`
            : "…";
        const statsLabel = stats
          ? `${stats.sales} sales · ${stats.uniqueBuyers} customer${stats.uniqueBuyers === 1 ? "" : "s"} · ${stats.refunds} refund${stats.refunds === 1 ? "" : "s"}`
          : chainOrders !== undefined
            ? `${chainOrders} orders`
            : "";

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
              <br />
              <span className="ink-soft">
                {priceLabel}
                {statsLabel ? ` · ${statsLabel}` : ""}
              </span>
            </span>
            <Link href={`/stores/${store}`} className="btn btn--ghost">
              Manage store
            </Link>
          </div>
        );
      })}
    </section>
  );
}
