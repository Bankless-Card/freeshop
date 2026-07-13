"use client";

import { useEffect, useState } from "react";
import { useConnectors } from "wagmi";

/**
 * Whether any configured connector has a real provider behind it. `connectors` always lists
 * the injected connector even when no wallet extension exists, so its length says nothing —
 * only getProvider() reveals absence. undefined until the first client-side check resolves.
 */
export function useHasWallet(): boolean | undefined {
  const connectors = useConnectors();
  const [hasWallet, setHasWallet] = useState<boolean>();

  useEffect(() => {
    let cancelled = false;
    void Promise.all(connectors.map((c) => c.getProvider().catch(() => undefined))).then(
      (providers) => {
        if (!cancelled) setHasWallet(providers.some(Boolean));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [connectors]);

  return hasWallet;
}
