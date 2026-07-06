"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { http, createConfig, WagmiProvider } from "wagmi";
import { injected } from "wagmi/connectors";
import { launcherChain } from "@/lib/chains";
import { publicEnv } from "@/lib/env";

const chain = launcherChain();

export const wagmiConfig = createConfig({
  chains: [chain],
  connectors: [injected()],
  transports: { [chain.id]: http(publicEnv.rpcUrl) },
});

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
