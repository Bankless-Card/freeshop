"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { erc20Abi, formatUnits, isAddress, type Hex } from "viem";
import { useReadContracts } from "wagmi";
import {
  ETH_SENTINEL,
  hashFulfillmentSchema,
  storeEscrowAbi,
  type FulfillmentField,
  type StoreConfig,
} from "@freeshop/shared";
import { AnalyticsPanel } from "@/components/Analytics";
import { OrdersTable } from "@/components/OrdersTable";
import { SchemaBuilder, fieldsAreValid } from "@/components/SchemaBuilder";
import { WithdrawPanel } from "@/components/WithdrawPanel";
import { launcherChain } from "@/lib/chains";
import { publicEnv } from "@/lib/env";
import { useAuth } from "@/lib/useAuth";
import { useStoreAnalytics } from "@/lib/useIndexer";

const DEFAULT_FIELDS: FulfillmentField[] = [
  { name: "email", label: "Email", type: "email", required: true, placeholder: "you@example.com" },
];

export default function StoreDetail() {
  const { address: rawAddress } = useParams<{ address: string }>();
  const storeAddress = (typeof rawAddress === "string" && isAddress(rawAddress) ? rawAddress : undefined) as
    | Hex
    | undefined;
  const { me } = useAuth();
  const queryClient = useQueryClient();
  const chain = launcherChain();

  // ——— on-chain facts (authoritative) ———
  const contract = { address: storeAddress!, abi: storeEscrowAbi } as const;
  const { data: facts } = useReadContracts({
    allowFailure: false,
    contracts: [
      { ...contract, functionName: "merchant" },
      { ...contract, functionName: "paymentToken" },
      { ...contract, functionName: "price" },
      { ...contract, functionName: "fulfillmentSchemaHash" },
    ],
    query: { enabled: !!storeAddress },
  });
  const [merchant, token, price, onChainSchemaHash] = facts ?? [];

  // Token metadata: ETH and the configured USDC are known; other ERC-20s read from the chain.
  const isEth = token === ETH_SENTINEL;
  const isKnownUsdc = !!token && !!publicEnv.usdcAddress && token.toLowerCase() === publicEnv.usdcAddress.toLowerCase();
  const { data: tokenMeta } = useReadContracts({
    allowFailure: false,
    contracts: [
      { address: token!, abi: erc20Abi, functionName: "symbol" },
      { address: token!, abi: erc20Abi, functionName: "decimals" },
    ],
    query: { enabled: !!token && !isEth && !isKnownUsdc },
  });
  const symbol = isEth ? "ETH" : isKnownUsdc ? "USDC" : (tokenMeta?.[0] ?? "TOKEN");
  const decimals = isEth ? 18 : isKnownUsdc ? 6 : (tokenMeta?.[1] ?? 18);

  const analytics = useStoreAnalytics(storeAddress);

  // ——— saved config ———
  const saved = useQuery({
    queryKey: ["store-config", storeAddress],
    enabled: !!storeAddress && !!me.data?.authenticated,
    retry: false,
    queryFn: async () => {
      const response = await fetch(`/api/stores/${storeAddress}/config`);
      if (response.status === 404) return null;
      if (!response.ok) throw new Error((await response.json()).error ?? `HTTP ${response.status}`);
      return (await response.json()) as { config: StoreConfig };
    },
  });

  // ——— editable product/form state, seeded from the saved config once it loads ———
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [fields, setFields] = useState<FulfillmentField[]>(DEFAULT_FIELDS);
  const [seeded, setSeeded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (seeded) return;
    // Seed once the fetch settles either way — an error must not strand the page on LOADING.
    if (saved.data === undefined && !saved.isError) return;
    if (saved.data) {
      const cfg = saved.data.config;
      setName(cfg.product.name);
      setDescription(cfg.product.description);
      setImageUrl(cfg.product.images[0] === "./product.svg" ? "" : (cfg.product.images[0] ?? ""));
      setFields(cfg.fulfillment.fields);
    }
    setSeeded(true);
  }, [saved.data, saved.isError, seeded]);

  if (!storeAddress) return <div className="boot">NOT A VALID STORE ADDRESS</div>;
  if (me.isPending || !seeded) return <div className="boot">LOADING…</div>;
  if (!me.data?.authenticated) {
    return (
      <div className="boot">
        NOT SIGNED IN — <a href="/">go to sign-in</a>
      </div>
    );
  }

  const notOwner = !!merchant && merchant.toLowerCase() !== me.data.address;
  const schemaMatches = !!onChainSchemaHash && hashFulfillmentSchema(fields) === onChainSchemaHash;
  const formValid = name.trim().length > 0 && fieldsAreValid(fields);
  const explorer = chain.blockExplorers?.default?.url;

  function buildConfig(): StoreConfig {
    return {
      version: 1,
      chainId: chain.id,
      storeAddress: storeAddress!,
      product: {
        name: name.trim(),
        description: description.trim(),
        images: [imageUrl.trim() || "./product.svg"],
      },
      payment: { token: token!, symbol, decimals, price: (price ?? 0n).toString() },
      fulfillment: { fields },
    };
  }

  function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function saveAndDownload(zip: boolean) {
    setBusy(true);
    setError(undefined);
    try {
      const config = buildConfig();
      const put = await fetch(`/api/stores/${storeAddress}/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      if (!put.ok) throw new Error((await put.json()).error ?? `HTTP ${put.status}`);
      void queryClient.invalidateQueries({ queryKey: ["store-config", storeAddress] });

      if (zip) {
        const pkg = await fetch("/api/storefront-package", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(config),
        });
        if (!pkg.ok) throw new Error((await pkg.json()).error ?? `HTTP ${pkg.status}`);
        downloadBlob(await pkg.blob(), "storefront.zip");
      } else {
        downloadBlob(new Blob([JSON.stringify(config, null, 2)], { type: "application/json" }), "store.config.json");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="reveal">
      <h1 className="section-title" style={{ marginTop: 40 }}>
        <span className="index">STORE</span> Storefront files
      </h1>
      <dl className="rows">
        <div>
          <dt>contract</dt>
          <dd>
            {explorer ? (
              <a href={`${explorer}/address/${storeAddress}`} target="_blank" rel="noreferrer">
                {storeAddress}
              </a>
            ) : (
              storeAddress
            )}
          </dd>
        </div>
        <div>
          <dt>price</dt>
          <dd>{price !== undefined ? `${formatUnits(price, decimals)} ${symbol}` : "reading…"}</dd>
        </div>
        <div>
          <dt>saved config</dt>
          <dd>
            {saved.isError
              ? "could not be loaded"
              : saved.data
                ? "on file — edit below and re-download any time"
                : "none on file — rebuild it below"}
          </dd>
        </div>
      </dl>

      {saved.isError && (
        <div className="error-box">
          Failed to load the saved config: {saved.error instanceof Error ? saved.error.message : "unknown error"}. The
          rebuild form below still works.
        </div>
      )}

      {notOwner && (
        <div className="note note--warn" style={{ marginTop: 20 }}>
          <span>⚠</span>
          <span>This store belongs to a different wallet; you can look, but saving is blocked.</span>
        </div>
      )}

      <section className="section-block">
        <h2 className="section-title">
          <span className="index">01</span> Analytics
        </h2>
        {analytics.isError ? (
          <div className="error-box">
            Analytics unavailable — is the indexer running? ({analytics.error.message})
          </div>
        ) : analytics.data ? (
          <AnalyticsPanel rollup={analytics.data} />
        ) : (
          <p className="mono" style={{ fontSize: 13 }}>
            Reading indexer…
          </p>
        )}
      </section>

      <section className="section-block">
        <h2 className="section-title">
          <span className="index">02</span> Orders
        </h2>
        <OrdersTable store={storeAddress} symbol={symbol} decimals={decimals} isOwner={!notOwner} />
      </section>

      <section className="section-block">
        <h2 className="section-title">
          <span className="index">03</span> Withdraw
        </h2>
        <WithdrawPanel
          store={storeAddress}
          symbol={symbol}
          decimals={decimals}
          unfulfilled={analytics.data?.unfulfilled}
        />
      </section>

      <div className="card" style={{ marginTop: 24 }}>
        <h2 className="section-title">
          <span className="index">04</span> Storefront files — product
        </h2>
        <div className="field">
          <label className="eyebrow" htmlFor="name">
            Product name *
          </label>
          <input id="name" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label className="eyebrow" htmlFor="desc">
            Description
          </label>
          <textarea id="desc" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="field">
          <label className="eyebrow" htmlFor="img">
            Image URL
          </label>
          <input id="img" value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} placeholder="https:// or leave blank" />
        </div>

        <h2 className="section-title" style={{ marginTop: 28 }}>
          <span className="index">04</span> Storefront files — order form
        </h2>
        {!saved.data && (
          <p style={{ marginTop: 0, fontSize: 14 }}>
            No saved copy of this store&apos;s form exists, so it must match what you chose at
            launch <em>exactly</em> — same fields, same order, same labels, keys, types, required
            flags, and placeholders. The indicator below compares against the commitment recorded
            on-chain at deploy.
          </p>
        )}
        <SchemaBuilder fields={fields} onChange={setFields} />

        {onChainSchemaHash &&
          (schemaMatches ? (
            <div className="note" style={{ marginTop: 18 }}>
              <span>✓</span>
              <span>Form matches the on-chain commitment — buyers&apos; checkout will verify cleanly.</span>
            </div>
          ) : (
            <div className="note note--warn" style={{ marginTop: 18 }}>
              <span>⚠</span>
              <span>
                Form does <strong>not</strong> match the commitment this store registered on-chain.
                A storefront built from it will warn buyers and disable checkout. Downloads stay
                disabled until it matches.
              </span>
            </div>
          ))}

        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 24 }}>
          <button
            type="button"
            className="btn btn--ink"
            disabled={busy || notOwner || !formValid || !schemaMatches}
            onClick={() => saveAndDownload(true)}
          >
            {busy ? "Working…" : "Save & download storefront.zip"}
          </button>
          <button
            type="button"
            className="btn"
            disabled={busy || notOwner || !formValid || !schemaMatches}
            onClick={() => saveAndDownload(false)}
          >
            store.config.json only
          </button>
        </div>
        {error && <div className="error-box">{error}</div>}
      </div>
    </div>
  );
}
