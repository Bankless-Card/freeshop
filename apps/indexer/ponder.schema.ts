import { index, onchainTable } from "ponder";

export const stores = onchainTable(
  "stores",
  (t) => ({
    address: t.hex().primaryKey(),
    merchant: t.hex().notNull(),
    paymentToken: t.hex().notNull(),
    price: t.bigint().notNull(),
    merchantPubKey: t.hex().notNull(),
    fulfillmentSchemaHash: t.hex().notNull(),
    deployedAt: t.bigint().notNull(),
  }),
  (table) => ({
    merchantIdx: index().on(table.merchant),
  }),
);

export const orders = onchainTable(
  "orders",
  (t) => ({
    /** `${store}-${orderId}` */
    id: t.text().primaryKey(),
    store: t.hex().notNull(),
    /** Denormalized from the store so merchant-wide analytics need no join. */
    merchant: t.hex().notNull(),
    orderId: t.bigint().notNull(),
    buyer: t.hex().notNull(),
    amount: t.bigint().notNull(),
    token: t.hex().notNull(),
    encryptedFulfillment: t.hex().notNull(),
    status: t.text().notNull(), // PAID | FULFILLED | CANCELLED | REFUNDED
    paidAt: t.bigint().notNull(),
    updatedAt: t.bigint().notNull(),
    txHash: t.hex().notNull(),
  }),
  (table) => ({
    storeIdx: index().on(table.store),
    merchantIdx: index().on(table.merchant),
  }),
);

export const withdrawals = onchainTable(
  "withdrawals",
  (t) => ({
    /** `${txHash}-${logIndex}` */
    id: t.text().primaryKey(),
    store: t.hex().notNull(),
    merchant: t.hex().notNull(),
    caller: t.hex().notNull(),
    amount: t.bigint().notNull(),
    at: t.bigint().notNull(),
  }),
  (table) => ({
    merchantIdx: index().on(table.merchant),
  }),
);
