import { useState } from "react";
import { useReadContract } from "wagmi";
import { storeEscrowAbi, type StoreConfig } from "@freeshop/shared";
import { formatAmount, truncateAddress } from "../lib/format";
import { ORDER_STATUS_LABELS } from "../lib/store";
import { Stamp } from "./Stamp";

function orderIdFromUrl(): string {
  const raw = new URLSearchParams(location.search).get("order");
  return raw && /^\d+$/.test(raw) ? raw : "";
}

export function StatusLookup({ config }: { config: StoreConfig }) {
  const [input, setInput] = useState(orderIdFromUrl);
  const [lookupId, setLookupId] = useState<bigint | undefined>(() =>
    orderIdFromUrl() ? BigInt(orderIdFromUrl()) : undefined,
  );

  const { data, isFetching, error } = useReadContract({
    address: config.storeAddress,
    abi: storeEscrowAbi,
    functionName: "orders",
    args: lookupId !== undefined ? [lookupId] : undefined,
    query: { enabled: lookupId !== undefined },
  });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!/^\d+$/.test(input.trim())) return;
    const id = BigInt(input.trim());
    setLookupId(id);
    history.replaceState(null, "", `?order=${id}`);
  }

  const [buyer, amount, statusCode] = data ?? [];
  const status = statusCode !== undefined ? ORDER_STATUS_LABELS[statusCode] : undefined;

  return (
    <section className="section">
      <h2 className="section__title">
        <span className="section__index">03</span> Check an order
      </h2>
      <form className="lookup__bar" onSubmit={submit}>
        <div className="field">
          <label className="eyebrow" htmlFor="order-lookup">
            Order no.
          </label>
          <input
            id="order-lookup"
            inputMode="numeric"
            placeholder="e.g. 1"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
        </div>
        <button type="submit" className="btn" disabled={isFetching || !/^\d+$/.test(input.trim())}>
          {isFetching ? "Reading…" : "Look up"}
        </button>
      </form>

      {error && <div className="error-box">Could not read the contract — try again shortly.</div>}

      {status !== undefined && lookupId !== undefined && (
        <div className="lookup__result">
          {status === "NONE" ? (
            <p className="mono" style={{ fontSize: 13 }}>
              No order № {lookupId.toString()} exists on this store.
            </p>
          ) : (
            <div className="receipt">
              <p className="eyebrow">Order no.</p>
              <p className="receipt__ordernum">№ {lookupId.toString()}</p>
              <Stamp status={status} />
              <dl style={{ marginTop: 24 }}>
                <div className="receipt__row">
                  <dt>buyer</dt>
                  <dd>{buyer ? truncateAddress(buyer) : "—"}</dd>
                </div>
                <div className="receipt__row">
                  <dt>amount</dt>
                  <dd>
                    {amount !== undefined
                      ? formatAmount(amount, config.payment.decimals, config.payment.symbol)
                      : "—"}
                  </dd>
                </div>
              </dl>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
