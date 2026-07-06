"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useAuth } from "@/lib/useAuth";

export default function Onboarding() {
  const router = useRouter();
  const { me, saveEmail } = useAuth();
  const [email, setEmail] = useState("");
  const [agreedCompliance, setAgreedCompliance] = useState(false);
  const [agreedCrypto, setAgreedCrypto] = useState(false);

  if (me.isPending) return <div className="boot">LOADING…</div>;
  if (!me.data?.authenticated) {
    return (
      <div className="boot">
        NOT SIGNED IN — <a href="/">go to sign-in</a>
      </div>
    );
  }

  const canSubmit = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && agreedCompliance && agreedCrypto;

  return (
    <div className="card reveal" style={{ maxWidth: 620 }}>
      <h1 className="section-title">
        <span className="index">SETUP</span> One thing before you launch
      </h1>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          await saveEmail.mutateAsync(email);
          router.push("/new");
        }}
      >
        <div className="field">
          <label className="eyebrow" htmlFor="email">
            Contact email *
          </label>
          <input
            id="email"
            type="email"
            required
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <p className="field__hint">
            Stored against your wallet address so we can reach you about your account. Not
            verified today; future opt-in sale notifications will use it. Never shown on your
            storefront, and you can delete it any time from Account.
          </p>
        </div>

        <p className="eyebrow" style={{ marginTop: 28 }}>
          Please acknowledge
        </p>
        <label className="check">
          <input
            type="checkbox"
            checked={agreedCompliance}
            onChange={(e) => setAgreedCompliance(e.target.checked)}
          />
          <span>
            <strong>I am solely responsible for compliance.</strong> Taxes, consumer protection,
            sanctions, and any other obligations that come with selling are mine. freeshop
            provides infrastructure only and is not a party to my sales.
          </span>
        </label>
        <label className="check">
          <input type="checkbox" checked={agreedCrypto} onChange={(e) => setAgreedCrypto(e.target.checked)} />
          <span>
            <strong>I understand how the encryption works.</strong> Customer order details are
            encrypted to a key derived from my wallet signature and recorded permanently on a
            public blockchain as ciphertext. They cannot be deleted; whoever controls my wallet
            can read them; if I lose the wallet, I lose the ability to read orders.
          </span>
        </label>

        <div className="wizard-nav">
          <span />
          <button type="submit" className="btn btn--ink" disabled={!canSubmit || saveEmail.isPending}>
            {saveEmail.isPending ? "Saving…" : "Continue"}
          </button>
        </div>
        {saveEmail.isError && <div className="error-box">{saveEmail.error.message}</div>}
      </form>
    </div>
  );
}
