"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccount, useSignMessage } from "wagmi";
import { createSiweMessage } from "viem/siwe";
import { launcherChain } from "./chains";

export interface Me {
  authenticated: boolean;
  address?: `0x${string}`;
  email?: string | null;
}

async function fetchJson<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error((body as { error?: string }).error ?? `HTTP ${response.status}`);
  return body as T;
}

/** Session state + SIWE sign-in/out. The wallet address is the merchant identity. */
export function useAuth() {
  const queryClient = useQueryClient();
  const { address: connectedAddress } = useAccount();
  const { signMessageAsync } = useSignMessage();

  const me = useQuery<Me>({
    queryKey: ["me"],
    queryFn: () => fetchJson<Me>("/api/me"),
  });

  const signIn = useMutation({
    // The address can be passed by a caller that just finished connecting — React state
    // (useAccount) hasn't re-rendered yet in that same tick.
    mutationFn: async (justConnectedAddress?: `0x${string}`) => {
      const address = justConnectedAddress ?? connectedAddress;
      if (!address) throw new Error("connect a wallet first");
      const { nonce } = await fetchJson<{ nonce: string }>("/api/auth/nonce");
      const message = createSiweMessage({
        address,
        chainId: launcherChain().id,
        domain: location.host,
        nonce,
        uri: location.origin,
        version: "1",
        statement: "Sign in to the freeshop launcher. This signature costs nothing.",
      });
      const signature = await signMessageAsync({ message });
      return fetchJson<{ address: `0x${string}` }>("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, signature }),
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["me"] }),
  });

  const signOut = useMutation({
    mutationFn: () => fetchJson<{ ok: boolean }>("/api/auth/logout", { method: "POST" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["me"] }),
  });

  const saveEmail = useMutation({
    mutationFn: (email: string) =>
      fetchJson<{ email: string }>("/api/me", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["me"] }),
  });

  const deleteAccount = useMutation({
    mutationFn: () => fetchJson<{ ok: boolean }>("/api/me", { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["me"] }),
  });

  return { me, signIn, signOut, saveEmail, deleteAccount };
}
