"use client";

import { useState } from "react";
import { formatUnits, type Hex } from "viem";
import { usePublicClient, useReadContract, useWriteContract } from "wagmi";
import { storeEscrowAbi } from "@freeshop/shared";

interface WithdrawPanelProps {
  store: Hex;
  symbol: string;
  decimals: number;
  unfulfilled: number | undefined;
}

export function WithdrawPanel({ store, symbol, decimals, unfulfilled }: WithdrawPanelProps) {
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const { data: available, refetch } = useReadContract({
    address: store,
    abi: storeEscrowAbi,
    functionName: "availableBalance",
    query: { refetchInterval: 15_000 },
  });

  async function withdraw() {
    setBusy(true);
    setError(undefined);
    try {
      const hash = await writeContractAsync({ address: store, abi: storeEscrowAbi, functionName: "withdraw" });
      await publicClient?.waitForTransactionReceipt({ hash, timeout: 120_000 });
      await refetch();
    } catch (err) {
      setError(err instanceof Error ? err.message.split("\n")[0] : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <dl className="rows">
        <div>
          <dt>withdrawable balance</dt>
          <dd>{available !== undefined ? `${formatUnits(available, decimals)} ${symbol}` : "reading…"}</dd>
        </div>
      </dl>
      {!!unfulfilled && unfulfilled > 0 && (
        <div className="note note--warn" style={{ marginTop: 16 }}>
          <span>⚠</span>
          <span>
            {unfulfilled} order{unfulfilled === 1 ? "" : "s"} awaiting fulfilment. Withdrawn funds
            are no longer in the contract to cover refunds — you would have to top the contract
            back up to refund later. Your call; the contract does not stop you.
          </span>
        </div>
      )}
      <button
        type="button"
        className="btn btn--ink"
        style={{ marginTop: 16 }}
        disabled={busy || !available}
        onClick={withdraw}
      >
        {busy ? "Withdrawing…" : "Withdraw to merchant address"}
      </button>
      <p className="field__hint">
        Anyone may trigger a withdrawal, but funds only ever go to the shop&apos;s permanent
        merchant address. You can also call <span className="mono">withdraw()</span> straight from
        a block explorer — this button is a convenience, not a dependency.
      </p>
      {error && <div className="error-box">{error}</div>}
    </>
  );
}
