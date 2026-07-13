"use client";

import { useEffect, useState } from "react";
import { formatEther, formatUnits, isAddress, parseEventLogs, parseUnits, type Hex } from "viem";
import { useAccount, useConnect, usePublicClient, useSignMessage, useSwitchChain, useWriteContract } from "wagmi";
import {
  ETH_SENTINEL,
  KEY_DERIVATION_MESSAGE,
  deriveMerchantKeyPair,
  hashFulfillmentSchema,
  storefrontFactoryAbi,
  type FulfillmentField,
  type StoreConfig,
} from "@freeshop/shared";
import { paymentAssets, type PaymentAsset } from "@/lib/assets";
import { launcherChain } from "@/lib/chains";
import { publicEnv } from "@/lib/env";
import { useAuth } from "@/lib/useAuth";
import { useHasWallet } from "@/lib/useHasWallet";
import { SchemaBuilder, fieldsAreValid } from "@/components/SchemaBuilder";

const STEPS = ["product", "order form", "encryption key", "review", "launched"] as const;
type Step = 0 | 1 | 2 | 3 | 4;

interface Draft {
  name: string;
  description: string;
  imageUrl: string;
  asset: PaymentAsset;
  priceInput: string;
  payoutAddress: string;
  fields: FulfillmentField[];
  merchantPubKey?: Hex;
}

const DEFAULT_FIELDS: FulfillmentField[] = [
  { name: "email", label: "Email", type: "email", required: true, placeholder: "you@example.com" },
];

export default function NewStore() {
  const { me } = useAuth();
  const { address: connected } = useAccount();
  const assets = paymentAssets();

  const [step, setStep] = useState<Step>(0);
  const [draft, setDraft] = useState<Draft>({
    name: "",
    description: "",
    imageUrl: "",
    asset: assets[0],
    priceInput: "",
    payoutAddress: "",
    fields: DEFAULT_FIELDS,
  });
  const [launched, setLaunched] = useState<{ storeAddress: Hex; txHash: Hex; config: StoreConfig }>();

  if (me.isPending) return <div className="boot">LOADING…</div>;
  if (!me.data?.authenticated || !me.data.email) {
    return (
      <div className="boot">
        {me.data?.authenticated ? (
          <>
            FINISH ONBOARDING FIRST — <a href="/onboarding">add your email</a>
          </>
        ) : (
          <>
            NOT SIGNED IN — <a href="/">go to sign-in</a>
          </>
        )}
      </div>
    );
  }
  if (!publicEnv.factoryAddress) {
    return <div className="boot">NEXT_PUBLIC_FACTORY_ADDRESS is not configured on this launcher.</div>;
  }

  const patch = (partial: Partial<Draft>) => setDraft((d) => ({ ...d, ...partial }));
  const payout = (draft.payoutAddress || connected || "") as Hex;

  return (
    <>
      <div className="steps reveal">
        {STEPS.map((label, i) => (
          <span key={label} data-state={i === step ? "active" : i < step ? "done" : undefined}>
            {label}
          </span>
        ))}
      </div>

      {step === 0 && (
        <ProductStep draft={draft} patch={patch} connected={connected} onNext={() => setStep(1)} />
      )}
      {step === 1 && (
        <FormStep draft={draft} patch={patch} onBack={() => setStep(0)} onNext={() => setStep(2)} />
      )}
      {step === 2 && (
        <KeyStep draft={draft} patch={patch} onBack={() => setStep(1)} onNext={() => setStep(3)} />
      )}
      {step === 3 && (
        <ReviewStep
          draft={draft}
          payout={payout}
          onBack={() => setStep(2)}
          onLaunched={(result) => {
            setLaunched(result);
            setStep(4);
          }}
        />
      )}
      {step === 4 && launched && <LaunchedStep {...launched} />}
    </>
  );
}

/* ——— step 1: product ——— */

function ProductStep({
  draft,
  patch,
  connected,
  onNext,
}: {
  draft: Draft;
  patch: (p: Partial<Draft>) => void;
  connected?: `0x${string}`;
  onNext: () => void;
}) {
  const assets = paymentAssets();
  const priceOk = /^\d+(\.\d+)?$/.test(draft.priceInput) && Number(draft.priceInput) > 0;
  const payoutOk = draft.payoutAddress === "" || isAddress(draft.payoutAddress);
  const ready = draft.name.trim().length > 0 && priceOk && payoutOk && (draft.payoutAddress !== "" || !!connected);

  return (
    <div className="card reveal">
      <h1 className="section-title">
        <span className="index">01</span> What are you selling?
      </h1>
      <div className="field">
        <label className="eyebrow" htmlFor="name">
          Product name *
        </label>
        <input id="name" value={draft.name} onChange={(e) => patch({ name: e.target.value })} />
      </div>
      <div className="field">
        <label className="eyebrow" htmlFor="desc">
          Description
        </label>
        <textarea
          id="desc"
          value={draft.description}
          onChange={(e) => patch({ description: e.target.value })}
          placeholder="What buyers see on your storefront. Blank lines become paragraphs."
        />
      </div>
      <div className="field">
        <label className="eyebrow" htmlFor="img">
          Image URL
        </label>
        <input
          id="img"
          value={draft.imageUrl}
          onChange={(e) => patch({ imageUrl: e.target.value })}
          placeholder="https:// or ipfs gateway URL — or leave blank and add a photo to the zip later"
        />
      </div>

      <p className="eyebrow" style={{ marginTop: 28 }}>
        Payment asset * <span style={{ textTransform: "none", letterSpacing: 0 }}>(fixed at launch — buyers cannot choose)</span>
      </p>
      <div className="choice-row">
        {assets.map((asset) => (
          <button
            key={asset.key}
            type="button"
            className="choice"
            aria-pressed={draft.asset.key === asset.key}
            onClick={() => patch({ asset })}
          >
            <strong>{asset.symbol}</strong>
            <span className="mono">{asset.hint}</span>
          </button>
        ))}
      </div>

      <div className="field" style={{ marginTop: 20 }}>
        <label className="eyebrow" htmlFor="price">
          Price ({draft.asset.symbol}) *
        </label>
        <input
          id="price"
          inputMode="decimal"
          value={draft.priceInput}
          onChange={(e) => patch({ priceInput: e.target.value })}
          placeholder={draft.asset.key === "ETH" ? "0.05" : "25"}
        />
        {!priceOk && draft.priceInput !== "" && <p className="field__error">Enter a positive number</p>}
      </div>

      <div className="field">
        <label className="eyebrow" htmlFor="payout">
          Payout address
        </label>
        <input
          id="payout"
          value={draft.payoutAddress}
          onChange={(e) => patch({ payoutAddress: e.target.value })}
          placeholder={connected ? `${connected} (connected wallet)` : "0x…"}
        />
        {!payoutOk && <p className="field__error">Not a valid address</p>}
        <p className="field__hint">
          Where withdrawals go. <strong>Permanent</strong> — it cannot be changed after launch; to
          switch wallets later you would launch a new store. Defaults to your connected wallet.
        </p>
      </div>

      <div className="wizard-nav">
        <span />
        <button type="button" className="btn btn--ink" disabled={!ready} onClick={onNext}>
          Next: order form
        </button>
      </div>
    </div>
  );
}

/* ——— step 2: fulfillment schema builder ——— */

function FormStep({
  draft,
  patch,
  onBack,
  onNext,
}: {
  draft: Draft;
  patch: (p: Partial<Draft>) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const valid = fieldsAreValid(draft.fields);

  return (
    <div className="card reveal">
      <h1 className="section-title">
        <span className="index">02</span> What do you need from buyers?
      </h1>
      <p style={{ marginTop: 0, fontSize: 14.5 }}>
        These fields become your checkout form. Buyers&apos; answers are encrypted in their browser
        to your key — no plaintext ever touches a server, ours included. Keep it lean: this data
        rides inside the payment transaction, and bytes cost gas.
      </p>

      <SchemaBuilder fields={draft.fields} onChange={(fields) => patch({ fields })} />

      <div className="wizard-nav">
        <button type="button" className="btn" onClick={onBack}>
          Back
        </button>
        <button type="button" className="btn btn--ink" disabled={!valid} onClick={onNext}>
          Next: encryption key
        </button>
      </div>
    </div>
  );
}

/* ——— step 3: key ceremony ——— */

function KeyStep({
  draft,
  patch,
  onBack,
  onNext,
}: {
  draft: Draft;
  patch: (p: Partial<Draft>) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const { signMessageAsync, isPending } = useSignMessage();
  const [error, setError] = useState<string>();

  async function derive() {
    setError(undefined);
    try {
      const signature = await signMessageAsync({ message: KEY_DERIVATION_MESSAGE });
      patch({ merchantPubKey: deriveMerchantKeyPair(signature).publicKey });
    } catch (err) {
      setError(err instanceof Error ? err.message.split("\n")[0] : String(err));
    }
  }

  return (
    <div className="card reveal">
      <h1 className="section-title">
        <span className="index">03</span> Create your encryption key
      </h1>
      <p style={{ marginTop: 0, fontSize: 14.5 }}>
        Buyers encrypt their order details to a key only you hold. It is derived from a wallet
        signature — sign the same message again any time, from any device, and the same key comes
        back. <strong>There is no file to download and nothing to back up.</strong>
      </p>

      <div className="note">
        <span>🔑</span>
        <span>
          The key belongs to the wallet that signs, so sign with the wallet you will use to read
          orders in the dashboard. Keep that wallet: lose it and past orders become unreadable —
          no one, including us, can recover them.
        </span>
      </div>
      <div className="note note--warn">
        <span>⚠</span>
        <span>
          Only ever sign this exact message on this launcher or your own dashboard. A site that
          tricks you into signing it can read your customers&apos; order details (it can never
          touch your funds).
        </span>
      </div>

      {draft.merchantPubKey ? (
        <dl className="rows">
          <div>
            <dt>public key</dt>
            <dd>{draft.merchantPubKey}</dd>
          </div>
        </dl>
      ) : (
        <button type="button" className="btn btn--ink" disabled={isPending} onClick={derive}>
          {isPending ? "Check your wallet…" : "Sign to create key"}
        </button>
      )}
      {error && <div className="error-box">{error}</div>}

      <div className="wizard-nav">
        <button type="button" className="btn" onClick={onBack}>
          Back
        </button>
        <button type="button" className="btn btn--ink" disabled={!draft.merchantPubKey} onClick={onNext}>
          Next: review
        </button>
      </div>
    </div>
  );
}

/* ——— step 4: review & deploy ——— */

function ReviewStep({
  draft,
  payout,
  onBack,
  onLaunched,
}: {
  draft: Draft;
  payout: Hex;
  onBack: () => void;
  onLaunched: (r: { storeAddress: Hex; txHash: Hex; config: StoreConfig }) => void;
}) {
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const { address: connected, chainId: walletChainId, isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const hasWallet = useHasWallet();
  const { switchChain, isPending: isSwitching, error: switchError } = useSwitchChain();
  const chain = launcherChain();

  // "wallet" = waiting for the user to confirm in their wallet; "mining" = tx sent, waiting
  // for the chain. Distinguished so a stuck deploy tells the user where it is stuck.
  const [phase, setPhase] = useState<"idle" | "wallet" | "mining">("idle");
  const [pendingTx, setPendingTx] = useState<Hex>();
  const [error, setError] = useState<string>();
  const [estimate, setEstimate] = useState<{ launchFee: bigint; gasEth?: string }>();
  const busy = phase !== "idle";

  const price = parseUnits(draft.priceInput, draft.asset.decimals);
  const schemaHash = hashFulfillmentSchema(draft.fields);
  const deployArgs = [payout, draft.asset.token, price, draft.merchantPubKey!, schemaHash] as const;

  useEffect(() => {
    if (!publicClient) return;
    let cancelled = false;
    (async () => {
      try {
        const launchFee = await publicClient.readContract({
          address: publicEnv.factoryAddress,
          abi: storefrontFactoryAbi,
          functionName: "launchFee",
        });
        let gasEth: string | undefined;
        try {
          const gas = await publicClient.estimateContractGas({
            address: publicEnv.factoryAddress,
            abi: storefrontFactoryAbi,
            functionName: "deployStore",
            args: deployArgs,
            value: launchFee,
            account: connected,
          });
          const gasPrice = await publicClient.getGasPrice();
          gasEth = formatEther(gas * gasPrice);
        } catch {
          /* estimate is best-effort; fee still shows */
        }
        if (!cancelled) setEstimate({ launchFee, gasEth });
      } catch {
        if (!cancelled) setError("could not read the factory contract — check your RPC");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicClient, connected]);

  async function deploy() {
    if (!publicClient || !estimate) return;
    setError(undefined);
    setPendingTx(undefined);
    let txHash: Hex | undefined;
    try {
      setPhase("wallet");
      // The factory requires msg.value == launchFee, so re-read the fee at submit time
      // in case the owner changed it after this page loaded.
      const launchFee = await publicClient.readContract({
        address: publicEnv.factoryAddress,
        abi: storefrontFactoryAbi,
        functionName: "launchFee",
      });
      if (launchFee !== estimate.launchFee) setEstimate({ ...estimate, launchFee });
      txHash = await writeContractAsync({
        address: publicEnv.factoryAddress,
        abi: storefrontFactoryAbi,
        functionName: "deployStore",
        args: deployArgs,
        value: launchFee,
      });
      setPendingTx(txHash);
      setPhase("mining");
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 120_000 });
      const [deployed] = parseEventLogs({
        abi: storefrontFactoryAbi,
        eventName: "StoreDeployed",
        logs: receipt.logs,
      });
      if (!deployed) throw new Error("transaction confirmed but no StoreDeployed event found");

      const config: StoreConfig = {
        version: 1,
        chainId: chain.id,
        storeAddress: deployed.args.store,
        deployBlock: Number(receipt.blockNumber),
        product: {
          name: draft.name.trim(),
          description: draft.description.trim(),
          images: [draft.imageUrl.trim() || "./product.svg"],
        },
        payment: {
          token: draft.asset.token,
          symbol: draft.asset.symbol,
          decimals: draft.asset.decimals,
          price: price.toString(),
        },
        fulfillment: { fields: draft.fields },
      };
      // Persist server-side so the package can be re-downloaded from /stores later.
      // Best-effort: the launch already succeeded on-chain, so never fail it over this.
      await fetch(`/api/stores/${deployed.args.store}/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      }).catch(() => {});

      onLaunched({ storeAddress: deployed.args.store, txHash, config });
    } catch (err) {
      if (err instanceof Error && err.name === "WaitForTransactionReceiptTimeoutError") {
        setError(
          `transaction ${txHash} was sent but not mined within 2 minutes. On a local anvil this ` +
            `usually means the wallet used a stale nonce after an anvil restart — in MetaMask: ` +
            `Settings → Advanced → Clear activity tab data, then try again.`,
        );
      } else {
        setError(err instanceof Error ? err.message.split("\n")[0] : String(err));
      }
    } finally {
      setPhase("idle");
    }
  }

  // Only flag a wrong chain when the wallet has definitively reported one. `chainId` can be
  // stale or briefly undefined while wagmi (re)connects — treating that as "wrong" strands the
  // user on a dead button.
  const wrongChain = isConnected && walletChainId !== undefined && walletChainId !== chain.id;

  return (
    <div className="card reveal">
      <h1 className="section-title">
        <span className="index">04</span> Review &amp; launch
      </h1>
      <dl className="rows">
        <div>
          <dt>product</dt>
          <dd>{draft.name}</dd>
        </div>
        <div>
          <dt>price</dt>
          <dd>
            {formatUnits(price, draft.asset.decimals)} {draft.asset.symbol}
          </dd>
        </div>
        <div>
          <dt>payout address (permanent)</dt>
          <dd>{payout}</dd>
        </div>
        <div>
          <dt>order form</dt>
          <dd>{draft.fields.map((f) => f.name).join(", ")}</dd>
        </div>
        <div>
          <dt>encryption key</dt>
          <dd>{draft.merchantPubKey?.slice(0, 18)}…</dd>
        </div>
        <div>
          <dt>launch fee</dt>
          <dd>{estimate ? `${formatEther(estimate.launchFee)} ETH` : "reading…"}</dd>
        </div>
        <div>
          <dt>deploy gas (est.)</dt>
          <dd>{estimate?.gasEth ? `~${Number(estimate.gasEth).toFixed(6)} ETH` : "—"}</dd>
        </div>
        <div>
          <dt>network</dt>
          <dd>
            {chain.name} (id {chain.id})
            {wrongChain ? ` — wallet is on chain ${walletChainId}` : ""}
          </dd>
        </div>
      </dl>

      <p className="field__hint" style={{ marginTop: 16 }}>
        Launching deploys a contract that only you control. We cannot pause it, change it, or
        touch its funds.
      </p>

      <div className="wizard-nav">
        <button type="button" className="btn" onClick={onBack} disabled={busy}>
          Back
        </button>
        {!isConnected ? (
          <button
            type="button"
            className="btn btn--ink"
            disabled={hasWallet === false}
            onClick={() => connect({ connector: connectors[0] })}
          >
            {hasWallet === false ? "No wallet detected" : "Connect wallet"}
          </button>
        ) : wrongChain ? (
          <button
            type="button"
            className="btn btn--ink"
            disabled={isSwitching}
            onClick={() => switchChain({ chainId: chain.id })}
          >
            {isSwitching ? "Switching…" : `Switch wallet to ${chain.name}`}
          </button>
        ) : (
          <button type="button" className="btn btn--ink" disabled={busy || !estimate} onClick={deploy}>
            {phase === "wallet"
              ? "Confirm in your wallet…"
              : phase === "mining"
                ? "Deploying…"
                : `Launch store (${estimate ? formatEther(estimate.launchFee) : "…"} ETH + gas)`}
          </button>
        )}
      </div>
      {phase === "wallet" && (
        <p className="field__hint" style={{ textAlign: "right" }}>
          No popup? Open your wallet extension directly — the request may be waiting there.
        </p>
      )}
      {phase === "mining" && pendingTx && (
        <p className="field__hint mono" style={{ textAlign: "right", overflowWrap: "anywhere" }}>
          tx sent: {pendingTx} — waiting for the chain (times out after 2 min)
        </p>
      )}
      {error && <div className="error-box">{error}</div>}
      {switchError && <div className="error-box">{switchError.message.split("\n")[0]}</div>}
    </div>
  );
}

/* ——— step 5: launched ——— */

function LaunchedStep({ storeAddress, txHash, config }: { storeAddress: Hex; txHash: Hex; config: StoreConfig }) {
  const [error, setError] = useState<string>();
  const chain = launcherChain();
  const explorer = chain.blockExplorers?.default?.url;

  function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function downloadZip() {
    setError(undefined);
    const response = await fetch("/api/storefront-package", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setError((body as { error?: string }).error ?? `HTTP ${response.status}`);
      return;
    }
    downloadBlob(await response.blob(), "storefront.zip");
  }

  return (
    <div className="card reveal">
      <span className="stamp">Launched</span>
      <h1 style={{ fontSize: 34, margin: "18px 0 6px" }}>{config.product.name} is live on-chain.</h1>
      <dl className="rows">
        <div>
          <dt>store contract</dt>
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
          <dt>deploy tx</dt>
          <dd>
            {explorer ? (
              <a href={`${explorer}/tx/${txHash}`} target="_blank" rel="noreferrer">
                {txHash.slice(0, 18)}…
              </a>
            ) : (
              txHash
            )}
          </dd>
        </div>
      </dl>

      <h2 className="section-title" style={{ marginTop: 28 }}>
        <span className="index">NEXT</span> Put your storefront online (free)
      </h2>
      <ol style={{ fontSize: 14.5, paddingLeft: 20, lineHeight: 1.8 }}>
        <li>
          Download your storefront — a ready-made static site with your store baked in. No build
          step needed.
        </li>
        <li>
          Host it anywhere static files go: GitHub Pages, Cloudflare Pages, Netlify, or your own
          server. Drag-and-drop the unzipped folder into Cloudflare Pages is the fastest path.
        </li>
        <li>Share the URL. You&apos;re in business.</li>
      </ol>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginTop: 12 }}>
        <button type="button" className="btn btn--ink" onClick={downloadZip}>
          Download storefront.zip
        </button>
        <button
          type="button"
          className="btn"
          onClick={() =>
            downloadBlob(
              new Blob([JSON.stringify(config, null, 2)], { type: "application/json" }),
              "store.config.json",
            )
          }
        >
          store.config.json only
        </button>
        {publicEnv.templateRepoUrl && (
          <a className="btn btn--ghost" href={publicEnv.templateRepoUrl} target="_blank" rel="noreferrer">
            Use the template repo
          </a>
        )}
      </div>
      {error && <div className="error-box">{error}</div>}

      <p className="field__hint" style={{ marginTop: 20 }}>
        Keep the wallet that signed your encryption key — it is the only thing that can read your
        orders. Your store appears under <a href="/stores">Stores</a>.
      </p>
    </div>
  );
}
