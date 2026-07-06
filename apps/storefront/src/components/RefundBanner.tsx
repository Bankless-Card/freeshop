import { useState } from "react";
import { useAccount, usePublicClient, useReadContract, useWriteContract } from "wagmi";
import { storeEscrowAbi, type StoreConfig } from "@freeshop/shared";
import { formatAmount, shortenError } from "../lib/format";

/**
 * Shown only when the connected wallet has a queued (push-failed) refund waiting to be claimed.
 */
export function RefundBanner({ config }: { config: StoreConfig }) {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const [claiming, setClaiming] = useState(false);
  const [error, setError] = useState<string>();

  const { data: pending, refetch } = useReadContract({
    address: config.storeAddress,
    abi: storeEscrowAbi,
    functionName: "pendingRefunds",
    args: address ? [address] : undefined,
    query: { enabled: !!address },
  });

  if (!address || !pending || pending === 0n) return null;

  async function claim() {
    setClaiming(true);
    setError(undefined);
    try {
      const hash = await writeContractAsync({
        address: config.storeAddress,
        abi: storeEscrowAbi,
        functionName: "claimRefund",
      });
      await publicClient?.waitForTransactionReceipt({ hash });
      await refetch();
    } catch (err) {
      setError(shortenError(err));
    } finally {
      setClaiming(false);
    }
  }

  return (
    <>
      <div className="refund-banner">
        <span>
          A refund of <strong>{formatAmount(pending, config.payment.decimals, config.payment.symbol)}</strong>{" "}
          is waiting for this wallet.
        </span>
        <button type="button" className="btn" disabled={claiming} onClick={() => void claim()}>
          {claiming ? "Claiming…" : "Claim refund"}
        </button>
      </div>
      {error && <div className="error-box">{error}</div>}
    </>
  );
}
