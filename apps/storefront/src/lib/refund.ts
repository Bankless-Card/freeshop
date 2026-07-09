import type { Chain, PublicClient } from "viem";
import { storeEscrowAbi, type StoreConfig } from "@freeshop/shared";
import { byId, errorText, hide, setSlot, show } from "./dom";
import { formatAmount } from "./format";
import * as wallet from "./wallet";

/** Shows a claim banner when the connected wallet has a queued (push-failed) refund. */
export function initRefundBanner(config: StoreConfig, publicClient: PublicClient, chain: Chain): void {
  const banner = byId("refund-banner");
  const claimBtn = byId<HTMLButtonElement>("claim-btn");
  if (!banner || !claimBtn) return;

  let pending = 0n;

  async function check(): Promise<void> {
    const { address } = wallet.getWallet();
    if (!address) {
      hide(banner);
      return;
    }
    try {
      pending = await publicClient.readContract({
        address: config.storeAddress,
        abi: storeEscrowAbi,
        functionName: "pendingRefunds",
        args: [address],
      });
    } catch {
      pending = 0n;
    }
    if (pending > 0n) {
      setSlot("refund-amount", formatAmount(pending, config.payment.decimals, config.payment.symbol));
      show(banner);
    } else {
      hide(banner);
    }
  }

  claimBtn.addEventListener("click", () => {
    void (async () => {
      const { address } = wallet.getWallet();
      if (!address || pending === 0n) return;
      claimBtn.disabled = true;
      hide(byId("refund-error"));
      try {
        const hash = await wallet.walletClient().writeContract({
          account: address,
          chain,
          address: config.storeAddress,
          abi: storeEscrowAbi,
          functionName: "claimRefund",
        });
        await publicClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
        await check();
      } catch (error) {
        const errorBox = byId("refund-error");
        if (errorBox) {
          errorBox.textContent = errorText(error);
          show(errorBox);
        }
      } finally {
        claimBtn.disabled = false;
      }
    })();
  });

  wallet.onWalletChange(() => void check());
}
