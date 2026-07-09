"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAccount, useConnect } from "wagmi";
import { useAuth } from "@/lib/useAuth";

export default function Home() {
  const router = useRouter();
  const { isConnected } = useAccount();
  const { connect, connectors, isPending: isConnecting } = useConnect();
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
        <p className="eyebrow">Decentralized storefront launcher</p>
        <h1>Sell one thing. Own the whole stack.</h1>
        <p>
          Pay a one-time fee to deploy your own escrow contract on Ethereum, and walk away with a
          free static storefront you host anywhere. Customers pay in ETH or USDC; their order
          details are encrypted to <em>your</em> key. No processors, no subscriptions, no server —
          and we are never between you and your money.
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
              <span className="index">01</span> Sign in with your wallet
            </h2>
            <p style={{ marginTop: 0 }}>
              Your wallet address is your account — no password. Signing costs nothing and sends
              no transaction.
            </p>
            {!isConnected ? (
              <button
                type="button"
                className="btn btn--ink"
                disabled={isConnecting || connectors.length === 0}
                onClick={() => connect({ connector: connectors[0] })}
              >
                {connectors.length === 0
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
