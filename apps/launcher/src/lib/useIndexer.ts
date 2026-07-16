"use client";

import { useQuery } from "@tanstack/react-query";

export interface Rollup {
  sales: number;
  uniqueBuyers: number;
  refunds: number;
  unfulfilled: number;
  revenue: { token: `0x${string}`; gross: string; refunded: string }[];
  salesByDay: { day: number; sales: number }[];
}

export interface MerchantAnalytics {
  aggregate: Rollup;
  stores: {
    address: `0x${string}`;
    paymentToken: `0x${string}`;
    price: string;
    deployedAt: number;
    sales: number;
    uniqueBuyers: number;
    refunds: number;
  }[];
}

export interface IndexedOrder {
  orderId: string;
  buyer: `0x${string}`;
  amount: string;
  token: `0x${string}`;
  status: "PAID" | "FULFILLED" | "CANCELLED" | "REFUNDED";
  encryptedFulfillment: `0x${string}`;
  paidAt: number;
  updatedAt: number;
  txHash: `0x${string}`;
}

async function fetchIndexer<T>(path: string): Promise<T> {
  const response = await fetch(`/api/indexer${path}`);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${response.status}`);
  return body as T;
}

export function useMerchantAnalytics(merchant: `0x${string}` | undefined) {
  return useQuery<MerchantAnalytics>({
    queryKey: ["indexer", "merchant-analytics", merchant],
    enabled: !!merchant,
    retry: 1,
    refetchInterval: 15_000,
    queryFn: () => fetchIndexer(`/merchants/${merchant}/analytics`),
  });
}

export function useStoreAnalytics(store: `0x${string}` | undefined) {
  return useQuery<Rollup>({
    queryKey: ["indexer", "store-analytics", store],
    enabled: !!store,
    retry: 1,
    refetchInterval: 15_000,
    queryFn: () => fetchIndexer(`/stores/${store}/analytics`),
  });
}

export interface OpenOrder {
  store: `0x${string}`;
  orderId: string;
  buyer: `0x${string}`;
  amount: string;
  token: `0x${string}`;
  status: "PAID" | "CANCELLED";
  paidAt: number;
}

/** Orders across all the merchant's shops that still need input (not fulfilled, not refunded). */
export function useMerchantOpenOrders(merchant: `0x${string}` | undefined) {
  return useQuery<{ orders: OpenOrder[] }>({
    queryKey: ["indexer", "merchant-open-orders", merchant],
    enabled: !!merchant,
    retry: 1,
    refetchInterval: 15_000,
    queryFn: () => fetchIndexer(`/merchants/${merchant}/open-orders`),
  });
}

export function useStoreOrders(store: `0x${string}` | undefined) {
  return useQuery<{ orders: IndexedOrder[] }>({
    queryKey: ["indexer", "store-orders", store],
    enabled: !!store,
    retry: 1,
    refetchInterval: 15_000,
    queryFn: () => fetchIndexer(`/stores/${store}/orders`),
  });
}
