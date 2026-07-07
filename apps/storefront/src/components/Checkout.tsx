import { useState } from "react";
import type { Chain } from "viem";
import { useAccount, useConnect, useSwitchChain } from "wagmi";
import { ETH_SENTINEL, type StoreConfig } from "@freeshop/shared";
import { explorerTxUrl } from "../lib/chain";
import { formatAmount, truncateAddress } from "../lib/format";
import type { StoreFacts } from "../lib/store";
import { useCheckout } from "../lib/useCheckout";
import { Stamp } from "./Stamp";

interface CheckoutProps {
  config: StoreConfig;
  chain: Chain;
  facts: StoreFacts | undefined;
  disabled: boolean;
}

export function Checkout({ config, chain, facts, disabled }: CheckoutProps) {
  const { address, isConnected, chainId } = useAccount();
  const { connect, connectors, isPending: isConnecting } = useConnect();
  const { switchChain, isPending: isSwitching } = useSwitchChain();

  const [values, setValues] = useState<Record<string, string>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const { progress, checkout, reset } = useCheckout(
    facts && address
      ? {
          storeAddress: config.storeAddress,
          paymentToken: facts.paymentToken,
          price: facts.price,
          merchantPubKey: facts.merchantPubKey,
          buyer: address,
        }
      : undefined,
  );

  // Only flag when the wallet has definitively reported a different chain — chainId can be
  // briefly undefined while wagmi (re)connects.
  const wrongChain = isConnected && chainId !== undefined && chainId !== chain.id;
  const isEth = (facts?.paymentToken ?? config.payment.token) === ETH_SENTINEL;
  const priceLabel = formatAmount(
    facts?.price ?? BigInt(config.payment.price),
    config.payment.decimals,
    config.payment.symbol,
  );

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const errors: Record<string, string> = {};
    for (const field of config.fulfillment.fields) {
      const value = (values[field.name] ?? "").trim();
      if (field.required && !value) errors[field.name] = "Required";
      if (field.type === "email" && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        errors[field.name] = "Not a valid email address";
      }
    }
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;

    const filled: Record<string, string> = {};
    for (const field of config.fulfillment.fields) {
      const value = (values[field.name] ?? "").trim();
      if (value) filled[field.name] = value;
    }
    void checkout(filled);
  }

  if (progress.status === "success" && progress.result) {
    const { orderId, txHash } = progress.result;
    const orderUrl = `${location.origin}${location.pathname}?order=${orderId}`;
    const txUrl = explorerTxUrl(chain, txHash);
    return (
      <section className="section">
        <h2 className="section__title">
          <span className="section__index">RECEIPT</span> Thank you.
        </h2>
        <div className="receipt">
          <p className="eyebrow">Order no.</p>
          <p className="receipt__ordernum">№ {orderId.toString()}</p>
          <Stamp status="PAID" />
          <dl style={{ marginTop: 24 }}>
            <div className="receipt__row">
              <dt>amount</dt>
              <dd>{priceLabel}</dd>
            </div>
            <div className="receipt__row">
              <dt>transaction</dt>
              <dd>{txUrl ? <a href={txUrl} target="_blank" rel="noreferrer">{truncateAddress(txHash)}</a> : txHash}</dd>
            </div>
            <div className="receipt__row">
              <dt>escrow</dt>
              <dd>{truncateAddress(config.storeAddress)}</dd>
            </div>
          </dl>
          <p className="receipt__hint">
            Save this link to check your order later: <a href={orderUrl}>{orderUrl}</a>
            <br />
            Your details were encrypted in this browser — only the merchant can read them.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="section">
      <h2 className="section__title">
        <span className="section__index">01</span> Your details
      </h2>
      <form onSubmit={submit} noValidate>
        {config.fulfillment.fields.map((field) => (
          <div className="field" key={field.name}>
            <label className="eyebrow" htmlFor={`f-${field.name}`}>
              {field.label}
              {field.required ? " *" : ""}
            </label>
            {field.type === "textarea" ? (
              <textarea
                id={`f-${field.name}`}
                placeholder={field.placeholder}
                value={values[field.name] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [field.name]: e.target.value }))}
              />
            ) : (
              <input
                id={`f-${field.name}`}
                type={field.type}
                placeholder={field.placeholder}
                value={values[field.name] ?? ""}
                onChange={(e) => setValues((v) => ({ ...v, [field.name]: e.target.value }))}
              />
            )}
            {fieldErrors[field.name] && <p className="field__error">{fieldErrors[field.name]}</p>}
          </div>
        ))}

        <div className="encrypt-note">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="4" y="10" width="16" height="11" stroke="currentColor" strokeWidth="2.4" />
            <path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="2.4" />
          </svg>
          <span>
            These details are encrypted <em>in your browser</em> with the merchant's public key
            before anything is sent. They ride along with your payment; no server ever sees them.
          </span>
        </div>

        <h2 className="section__title">
          <span className="section__index">02</span> Payment
        </h2>

        {!isConnected ? (
          <button
            type="button"
            className="btn btn--ink"
            disabled={isConnecting || connectors.length === 0}
            onClick={() => connect({ connector: connectors[0] })}
          >
            {connectors.length === 0
              ? "No wallet detected — install one to pay"
              : isConnecting
                ? "Connecting…"
                : "Connect wallet to pay"}
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
          <button type="submit" className="btn btn--ink" disabled={disabled || !facts || progress.status === "running"}>
            {progress.status === "running" ? "Processing…" : `Pay ${priceLabel}`}
          </button>
        )}

        {!isEth && isConnected && !wrongChain && (
          <p className="receipt__hint">
            Paying in {config.payment.symbol} takes two wallet confirmations: an approval, then the
            payment itself.
          </p>
        )}

        {progress.steps.length > 0 && (
          <ul className="progress">
            {progress.steps.map((step) => (
              <li key={step.id} data-state={step.state}>
                <span>{step.label}</span>
              </li>
            ))}
          </ul>
        )}

        {progress.status === "error" && (
          <div className="error-box">
            {progress.error}
            <div style={{ marginTop: 8 }}>
              <button type="button" className="btn btn--ghost" onClick={reset}>
                Dismiss
              </button>
            </div>
          </div>
        )}
      </form>
    </section>
  );
}
