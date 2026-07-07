import { useCallback, useState } from "react";
import { erc20Abi, parseEventLogs, type Hex } from "viem";
import { usePublicClient, useWriteContract } from "wagmi";
import { ETH_SENTINEL, encryptFulfillment, storeEscrowAbi } from "@freeshop/shared";
import { shortenError } from "./format";

export type CheckoutStepId = "encrypt" | "approve" | "pay" | "confirm";
export type StepState = "todo" | "active" | "done" | "error";

export interface CheckoutProgress {
  steps: { id: CheckoutStepId; label: string; state: StepState }[];
  status: "idle" | "running" | "success" | "error";
  error?: string;
  result?: { orderId: bigint; txHash: Hex };
}

const IDLE: CheckoutProgress = { steps: [], status: "idle" };

interface CheckoutParams {
  storeAddress: Hex;
  paymentToken: Hex;
  price: bigint;
  merchantPubKey: Hex;
  buyer: Hex;
}

/**
 * Runs the purchase: encrypt fulfillment in-browser → (ERC-20 only: approve if allowance short)
 * → pay → wait for the receipt and pull the orderId out of the OrderPlaced log.
 */
export function useCheckout(params: CheckoutParams | undefined) {
  const publicClient = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const [progress, setProgress] = useState<CheckoutProgress>(IDLE);

  const reset = useCallback(() => setProgress(IDLE), []);

  const checkout = useCallback(
    async (fields: Record<string, string>) => {
      if (!params || !publicClient) return;
      const { storeAddress, paymentToken, price, merchantPubKey, buyer } = params;
      const isEth = paymentToken === ETH_SENTINEL;

      const stepList: { id: CheckoutStepId; label: string }[] = [
        { id: "encrypt", label: "Encrypting your details in this browser" },
        ...(isEth ? [] : [{ id: "approve" as const, label: "Approving token spend" }]),
        { id: "pay", label: "Sending payment to escrow" },
        { id: "confirm", label: "Waiting for on-chain confirmation" },
      ];
      const stateOf = (id: CheckoutStepId, active: CheckoutStepId, failed = false): StepState => {
        const order = stepList.map((s) => s.id);
        if (id === active) return failed ? "error" : "active";
        return order.indexOf(id) < order.indexOf(active) ? "done" : "todo";
      };
      const render = (active: CheckoutStepId, failed = false) =>
        setProgress((p) => ({
          ...p,
          status: failed ? "error" : "running",
          steps: stepList.map((s) => ({ ...s, state: stateOf(s.id, active, failed) })),
        }));

      let active: CheckoutStepId = "encrypt";
      try {
        render(active);
        const payload = encryptFulfillment(fields, merchantPubKey);

        if (!isEth) {
          active = "approve";
          render(active);
          const allowance = await publicClient.readContract({
            address: paymentToken,
            abi: erc20Abi,
            functionName: "allowance",
            args: [buyer, storeAddress],
          });
          if (allowance < price) {
            const approveHash = await writeContractAsync({
              address: paymentToken,
              abi: erc20Abi,
              functionName: "approve",
              args: [storeAddress, price],
            });
            await publicClient.waitForTransactionReceipt({ hash: approveHash, timeout: 120_000 });
          }
        }

        active = "pay";
        render(active);
        const txHash = await writeContractAsync({
          address: storeAddress,
          abi: storeEscrowAbi,
          functionName: "pay",
          args: [payload],
          value: isEth ? price : 0n,
        });

        active = "confirm";
        render(active);
        const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash, timeout: 120_000 });
        const [placed] = parseEventLogs({ abi: storeEscrowAbi, eventName: "OrderPlaced", logs: receipt.logs });
        if (!placed) throw new Error("transaction confirmed but no OrderPlaced event found");

        setProgress({
          status: "success",
          steps: stepList.map((s) => ({ ...s, state: "done" })),
          result: { orderId: placed.args.orderId, txHash },
        });
      } catch (error) {
        render(active, true);
        setProgress((p) => ({ ...p, status: "error", error: shortenError(error) }));
      }
    },
    [params, publicClient, writeContractAsync],
  );

  return { progress, checkout, reset };
}
