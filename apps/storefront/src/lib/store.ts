import { storeEscrowAbi } from "@freeshop/shared";
import { useReadContracts } from "wagmi";
import type { Hex } from "viem";

export const ORDER_STATUS_LABELS = ["NONE", "PAID", "FULFILLED", "CANCELLED", "REFUNDED"] as const;
export type OrderStatusLabel = (typeof ORDER_STATUS_LABELS)[number];

export interface StoreFacts {
  price: bigint;
  paymentToken: Hex;
  merchantPubKey: Hex;
  fulfillmentSchemaHash: Hex;
  orderCount: bigint;
}

/** Live store facts read from the contract — authoritative over anything in the config file. */
export function useStoreFacts(storeAddress: Hex) {
  const contract = { address: storeAddress, abi: storeEscrowAbi } as const;
  const { data, isPending, error } = useReadContracts({
    allowFailure: false,
    contracts: [
      { ...contract, functionName: "price" },
      { ...contract, functionName: "paymentToken" },
      { ...contract, functionName: "merchantPubKey" },
      { ...contract, functionName: "fulfillmentSchemaHash" },
      { ...contract, functionName: "orderCount" },
    ],
  });

  const facts: StoreFacts | undefined = data && {
    price: data[0],
    paymentToken: data[1],
    merchantPubKey: data[2],
    fulfillmentSchemaHash: data[3],
    orderCount: data[4],
  };
  return { facts, isPending, error };
}
