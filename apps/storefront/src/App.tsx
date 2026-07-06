import { useMemo } from "react";
import type { Chain } from "viem";
import { hashFulfillmentSchema, type StoreConfig } from "@freeshop/shared";
import { Checkout } from "./components/Checkout";
import { Colophon } from "./components/Colophon";
import { Masthead } from "./components/Masthead";
import { RefundBanner } from "./components/RefundBanner";
import { StatusLookup } from "./components/StatusLookup";
import { formatAmount } from "./lib/format";
import { useStoreFacts } from "./lib/store";

export function App({ config, chain }: { config: StoreConfig; chain: Chain }) {
  const { facts, isPending, error } = useStoreFacts(config.storeAddress);

  // The contract is the source of truth; the config copy is only for instant first paint.
  const price = facts?.price ?? BigInt(config.payment.price);
  const schemaMismatch = useMemo(
    () => !!facts && hashFulfillmentSchema(config.fulfillment.fields) !== facts.fulfillmentSchemaHash,
    [facts, config.fulfillment.fields],
  );

  return (
    <>
      <div className="reveal" style={{ "--i": 0 } as React.CSSProperties}>
        <Masthead config={config} chain={chain} />
      </div>

      <section className="product reveal" style={{ "--i": 1 } as React.CSSProperties}>
        <h1 className="product__name">{config.product.name}</h1>
        <div className="product__priceline">
          <span className="product__price">
            {formatAmount(price, config.payment.decimals, config.payment.symbol)}
          </span>
          <span className="product__meta">
            {facts ? `${facts.orderCount} sold to date` : isPending ? "reading contract…" : ""}
          </span>
        </div>
        {config.product.images[0] && (
          <figure className="product__figure">
            <img src={config.product.images[0]} alt={config.product.name} />
          </figure>
        )}
        <p className="product__description">{config.product.description}</p>

        {error && (
          <div className="warn-banner">
            COULD NOT REACH THE STORE CONTRACT — displayed details come from the config file and
            payment is disabled until the RPC recovers.
          </div>
        )}
        {schemaMismatch && (
          <div className="warn-banner">
            WARNING: this form does not match the schema the merchant registered on-chain. Do not
            submit sensitive details — contact the merchant.
          </div>
        )}
      </section>

      <hr className="rule-dashed" />

      <div className="reveal" style={{ "--i": 2 } as React.CSSProperties}>
        <Checkout config={config} chain={chain} facts={facts} disabled={!!error || schemaMismatch} />
      </div>

      <hr className="rule-dashed" />

      <div className="reveal" style={{ "--i": 3 } as React.CSSProperties}>
        <StatusLookup config={config} />
        <RefundBanner config={config} />
      </div>

      <Colophon config={config} chain={chain} />
    </>
  );
}
