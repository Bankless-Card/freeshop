"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/lib/useAuth";

export default function Account() {
  const router = useRouter();
  const { me, saveEmail, deleteAccount } = useAuth();
  const [email, setEmail] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (me.data?.email) setEmail(me.data.email);
  }, [me.data?.email]);

  if (me.isPending) return <div className="boot">LOADING…</div>;
  if (!me.data?.authenticated) {
    return (
      <div className="boot">
        NOT SIGNED IN — <a href="/">go to sign-in</a>
      </div>
    );
  }

  return (
    <div className="card reveal" style={{ maxWidth: 620 }}>
      <h1 className="section-title">
        <span className="index">ACCOUNT</span> {me.data.address?.slice(0, 10)}…
      </h1>

      <form
        onSubmit={async (e) => {
          e.preventDefault();
          await saveEmail.mutateAsync(email);
          setSaved(true);
          setTimeout(() => setSaved(false), 2500);
        }}
      >
        <div className="field">
          <label className="eyebrow" htmlFor="email">
            Contact email
          </label>
          <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <button type="submit" className="btn" disabled={saveEmail.isPending}>
          {saveEmail.isPending ? "Saving…" : saved ? "Saved ✓" : "Update email"}
        </button>
        {saveEmail.isError && <div className="error-box">{saveEmail.error.message}</div>}
      </form>

      <hr className="rule-dashed" style={{ margin: "28px 0" }} />

      <p className="eyebrow">Danger zone</p>
      <p style={{ fontSize: 14 }}>
        Deleting your account removes your email from our records and signs you out. Your stores
        and their funds live on-chain and are completely unaffected — you can sign back in with
        the same wallet any time and they will still be yours.
      </p>
      <button
        type="button"
        className="btn btn--danger"
        disabled={deleteAccount.isPending}
        onClick={async () => {
          if (!confirm("Delete your account record (stored email)? Your on-chain stores are unaffected.")) return;
          await deleteAccount.mutateAsync();
          router.push("/");
        }}
      >
        {deleteAccount.isPending ? "Deleting…" : "Delete account"}
      </button>
    </div>
  );
}
