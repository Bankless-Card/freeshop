"use client";

import Link from "next/link";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { useAuth } from "@/lib/useAuth";
import { useHasWallet } from "@/lib/useHasWallet";

function truncate(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function Masthead() {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const hasWallet = useHasWallet();
  const { disconnect } = useDisconnect();
  const { me, signOut } = useAuth();

  return (
    <header className="masthead">
      <Link href="/" className="masthead__brand">
        free<em>shop</em>
      </Link>
      <nav className="masthead__nav">
        {me.data?.authenticated && (
          <>
            <Link href="/stores">Shops</Link>
            <Link href="/new">New shop</Link>
            <Link href="/account">Account</Link>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => {
                signOut.mutate();
                disconnect();
              }}
            >
              Sign out
            </button>
          </>
        )}
        {!me.data?.authenticated &&
          (isConnected && address ? (
            <span className="mono" title={address}>
              {truncate(address)}
            </span>
          ) : (
            <button
              type="button"
              className="btn"
              disabled={isPending || hasWallet === false}
              onClick={() => connect({ connector: connectors[0] })}
            >
              {hasWallet === false ? "No wallet" : isPending ? "Connecting…" : "Connect"}
            </button>
          ))}
      </nav>
    </header>
  );
}
