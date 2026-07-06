import "@fontsource/fraunces/600.css";
import "@fontsource/fraunces/900.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "@fontsource/ibm-plex-mono/600.css";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "./styles.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { http, createConfig, WagmiProvider } from "wagmi";
import { injected } from "wagmi/connectors";
import { parseStoreConfig, type StoreConfig } from "@freeshop/shared";
import { App } from "./App";
import { resolveChain } from "./lib/chain";

const root = createRoot(document.getElementById("root")!);
root.render(<div className="boot">LOADING STORE…</div>);

async function boot() {
  // Runtime-fetched so merchants can edit the config on their host without rebuilding.
  const response = await fetch(`${import.meta.env.BASE_URL}store.config.json`, { cache: "no-cache" });
  if (!response.ok) throw new Error(`could not load store.config.json (HTTP ${response.status})`);
  const config: StoreConfig = parseStoreConfig(await response.json());

  const chain = resolveChain(config);
  const wagmiConfig = createConfig({
    chains: [chain],
    connectors: [injected()],
    transports: { [chain.id]: http(config.rpcUrl) },
  });

  document.title = config.product.name;

  root.render(
    <StrictMode>
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={new QueryClient()}>
          <App config={config} chain={chain} />
        </QueryClientProvider>
      </WagmiProvider>
    </StrictMode>,
  );
}

boot().catch((error) => {
  root.render(
    <div className="boot boot--error">
      {"THIS STORE FAILED TO LOAD\n\n"}
      {error instanceof Error ? error.message : String(error)}
      {"\n\nIf you are the merchant: check store.config.json."}
    </div>,
  );
});
