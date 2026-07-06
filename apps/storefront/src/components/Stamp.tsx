import type { OrderStatusLabel } from "../lib/store";

const STAMP_CLASS: Record<OrderStatusLabel, string> = {
  NONE: "stamp--cancelled",
  PAID: "stamp--paid",
  FULFILLED: "stamp--fulfilled",
  CANCELLED: "stamp--cancelled",
  REFUNDED: "stamp--refunded",
};

export function Stamp({ status }: { status: OrderStatusLabel }) {
  return <span className={`stamp ${STAMP_CLASS[status]}`}>{status}</span>;
}
