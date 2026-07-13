"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAccount, useConnect } from "wagmi";
import { useAuth } from "@/lib/useAuth";
import { useHasWallet } from "@/lib/useHasWallet";

/** Shown when no wallet is detected — e.g. plain mobile Safari/Chrome. */
function MobileWalletHint() {
  const [copied, setCopied] = useState(false);
  return (
    <div className="note">
      <span>
        On a phone? Open this page inside your wallet app&apos;s built-in browser (in MetaMask:
        menu → Browser) and connect from there.{" "}
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => {
            void navigator.clipboard.writeText(location.href).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            });
          }}
        >
          {copied ? "Copied" : "Copy link"}
        </button>
      </span>
    </div>
  );
}

export default function Home() {
  const router = useRouter();
  const { isConnected } = useAccount();
  const { connect, connectors, isPending: isConnecting } = useConnect();
  const hasWallet = useHasWallet();
  const { me, signIn } = useAuth();

  // Navigate onward only as the result of the sign-in action itself — a signed-in visitor to
  // the home page stays on the home page.
  async function signInAndContinue() {
    await signIn.mutateAsync();
    const state = (await (await fetch("/api/me")).json()) as { email?: string | null };
    router.push(state.email ? "/stores" : "/onboarding");
  }

  return (
    <>
      <section className="hero reveal">
        <p className="eyebrow">Sovereign e-commerce </p>
        <h1>Own your storefront.  Own your business.</h1>
        <p>
          Most online business use 2-3 intermediaries to get paid (ex. Shopify, Etsy, Stripe, Paypal).
          They charge monthly, with fees on every transaction.  
          They close storefonts and hold funds without warning and without recourse.  
        </p>
        <p>
          Freeshop charges a one-time fee to create a storefront owned by <em>you</em> and no one else.
          We launch a smart contract on Ethereum so you can accept ETH and USDC direction (no middleman).
          We let you download the code which you can edit yourself and host for free (no monthly fees).
        </p>
      </section>

      <div className="card reveal" style={{ "--i": 1 } as React.CSSProperties}>
        {me.data?.authenticated ? (
          <>
            <h2 className="section-title">
              <span className="index">01</span> You&apos;re signed in
            </h2>
            <p style={{ marginTop: 0 }}>Pick up where you left off.</p>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              <Link href={me.data.email ? "/stores" : "/onboarding"} className="btn btn--ink">
                {me.data.email ? "Go to your stores" : "Finish onboarding"}
              </Link>
              {me.data.email && (
                <Link href="/new" className="btn">
                  Launch a new store
                </Link>
              )}
            </div>
          </>
        ) : (
          <>
            <h2 className="section-title">
              <span className="index">01</span> Sign in with your Ethereum wallet
            </h2>
            <p style={{ marginTop: 0 }}>
              Your wallet is your account — no password needed. Signing costs nothing and sends
              no transaction.
            </p>
            {!isConnected ? (
              <button
                type="button"
                className="btn btn--ink"
                disabled={isConnecting || hasWallet === false}
                onClick={() => connect({ connector: connectors[0] })}
              >
                {hasWallet === false
                  ? "No wallet detected — install one first"
                  : isConnecting
                    ? "Connecting…"
                    : "Connect wallet"}
              </button>
            ) : (
              <button
                type="button"
                className="btn btn--ink"
                disabled={signIn.isPending}
                onClick={() => void signInAndContinue()}
              >
                {signIn.isPending ? "Check your wallet…" : "Sign in with Ethereum"}
              </button>
            )}
            {hasWallet === false && <MobileWalletHint />}
            {signIn.isError && <div className="error-box">{signIn.error.message}</div>}
          </>
        )}
      </div>

      <dl className="rows reveal" style={{ "--i": 2 } as React.CSSProperties}>
        <div>
          <dt>you keep</dt>
          <dd>contract ownership, funds, refund power, customer data (encrypted to your key)</dd>
        </div>
        <div>
          <dt>you pay</dt>
          <dd>0.01 ETH once per store + gas · storefront hosting is free</dd>
        </div>
        <div>
          <dt>we never see</dt>
          <dd>your funds or your customers&apos; details — the storefront has no backend at all</dd>
        </div>
      </dl>
    </>
  );
}
