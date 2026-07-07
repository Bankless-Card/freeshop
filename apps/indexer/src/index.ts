import { ponder } from "ponder:registry";
import { orders, stores, withdrawals } from "ponder:schema";

const STATUS_LABELS = ["NONE", "PAID", "FULFILLED", "CANCELLED", "REFUNDED"] as const;

ponder.on("StorefrontFactory:StoreDeployed", async ({ event, context }) => {
  await context.db.insert(stores).values({
    address: event.args.store,
    merchant: event.args.merchant,
    paymentToken: event.args.paymentToken,
    price: event.args.price,
    merchantPubKey: event.args.merchantPubKey,
    fulfillmentSchemaHash: event.args.fulfillmentSchemaHash,
    deployedAt: event.block.timestamp,
  });
});

ponder.on("StoreEscrow:OrderPlaced", async ({ event, context }) => {
  const store = await context.db.find(stores, { address: event.log.address });
  await context.db.insert(orders).values({
    id: `${event.log.address}-${event.args.orderId}`,
    store: event.log.address,
    merchant: store?.merchant ?? "0x0000000000000000000000000000000000000000",
    orderId: event.args.orderId,
    buyer: event.args.buyer,
    amount: event.args.amount,
    token: event.args.paymentToken,
    encryptedFulfillment: event.args.encryptedFulfillment,
    status: "PAID",
    paidAt: event.block.timestamp,
    updatedAt: event.block.timestamp,
    txHash: event.transaction.hash,
  });
});

ponder.on("StoreEscrow:StatusChanged", async ({ event, context }) => {
  await context.db
    .update(orders, { id: `${event.log.address}-${event.args.orderId}` })
    .set({ status: STATUS_LABELS[event.args.newStatus] ?? "NONE", updatedAt: event.block.timestamp });
});

// refund() emits StatusChanged then Refunded; both land on REFUNDED, so this is idempotent.
ponder.on("StoreEscrow:Refunded", async ({ event, context }) => {
  await context.db
    .update(orders, { id: `${event.log.address}-${event.args.orderId}` })
    .set({ status: "REFUNDED", updatedAt: event.block.timestamp });
});

ponder.on("StoreEscrow:Withdrawn", async ({ event, context }) => {
  const store = await context.db.find(stores, { address: event.log.address });
  await context.db.insert(withdrawals).values({
    id: `${event.transaction.hash}-${event.log.logIndex}`,
    store: event.log.address,
    merchant: store?.merchant ?? "0x0000000000000000000000000000000000000000",
    caller: event.args.caller,
    amount: event.args.amount,
    at: event.block.timestamp,
  });
});
