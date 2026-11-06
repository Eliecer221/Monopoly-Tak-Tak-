import crypto from "node:crypto";

// Catálogo de la tienda y lógica de compra.
//
// Esto es lo que genera ingresos reales: el juego es gratis y el jugador paga
// por monedas, dados, gemas y el pase de temporada. Es comercio electrónico
// normal, no una apuesta: no se paga para apostar ni hay premio en metálico.

export const PRODUCTS = [
  { id: "coins_500", kind: "coins", name: "500 monedas TAK", priceCents: 199, currency: "usd", coins: 500 },
  { id: "coins_1500", kind: "coins", name: "1.500 monedas TAK", priceCents: 499, currency: "usd", coins: 1500 },
  { id: "coins_4000", kind: "coins", name: "4.000 monedas TAK", priceCents: 999, currency: "usd", coins: 4000 },
  { id: "coins_10000", kind: "coins", name: "10.000 monedas TAK", priceCents: 1999, currency: "usd", coins: 10000 },
  { id: "dice_20", kind: "dice", name: "20 dados", priceCents: 299, currency: "usd", dice: 20 },
  { id: "gems_100", kind: "gems", name: "100 gemas", priceCents: 499, currency: "usd", gems: 100 },
  { id: "season_pass", kind: "pass", name: "Pase de temporada", priceCents: 999, currency: "usd", entitlement: "season_pass" },
];

export function productById(id) {
  return PRODUCTS.find((p) => p.id === id) || null;
}

export function catalog() {
  return PRODUCTS.map(({ id, kind, name, priceCents, currency }) => ({
    id,
    kind,
    name,
    priceCents,
    currency,
  }));
}

// Aplica el contenido de un producto a la cartera del usuario.
export function applyProduct(user, product) {
  const wallet = { ...(user.wallet || { coins: 0, gems: 0, dice: 0 }) };
  if (product.coins) wallet.coins += product.coins;
  if (product.gems) wallet.gems += product.gems;
  if (product.dice) wallet.dice += product.dice;
  const update = {
    wallet,
    purchases: (user.purchases || 0) + 1,
    spentCents: (user.spentCents || 0) + product.priceCents,
  };
  if (product.entitlement) update.entitlement = product.entitlement;
  return update;
}

// Registro de gasto que alimentan los límites diarios y semanales.
export function spendEntry(order) {
  return { at: new Date().toISOString(), amountCents: order.amountCents, orderId: order.id };
}

export class Store {
  constructor(db) {
    this.db = db;
    this.orders = db.collection("orders");
    this.users = db.collection("users");
    this.transactions = db.collection("transactions");
  }

  async createOrder(user, product, provider) {
    const order = {
      id: crypto.randomUUID(),
      userId: user.id,
      productId: product.id,
      amountCents: product.priceCents,
      currency: product.currency,
      provider,
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    await this.orders.insertOne(order);
    return order;
  }

  async getOrder(id) {
    return this.orders.findOne({ id });
  }

  async markPendingRef(id, providerRef) {
    await this.orders.updateOne({ id }, { $set: { providerRef } });
  }

  // Acredita una orden pagada. Idempotente: si la orden ya está pagada, no
  // vuelve a sumar saldo. Un webhook repetido es lo normal, no una excepción.
  async creditOrder(orderId, providerRef = null) {
    const order = await this.orders.findOne({ id: orderId });
    if (!order) return { error: "orden desconocida" };
    if (order.status === "paid") return { value: { alreadyPaid: true, order } };

    const product = productById(order.productId);
    if (!product) return { error: "producto desconocido" };

    const user = await this.users.findOne({ id: order.userId });
    if (!user) return { error: "usuario desconocido" };

    const update = applyProduct(user, product);
    await this.users.updateOne(
      { id: user.id },
      { $set: update, $push: { spentLog: spendEntry(order) } }
    );
    await this.orders.updateOne(
      { id: orderId },
      { $set: { status: "paid", paidAt: new Date().toISOString(), providerRef } }
    );
    await this.transactions.insertOne({
      id: crypto.randomUUID(),
      userId: user.id,
      orderId,
      productId: product.id,
      amountCents: order.amountCents,
      currency: order.currency,
      provider: order.provider,
      idempotencyKey: `${order.provider}:${providerRef || orderId}`,
      at: new Date().toISOString(),
    });
    return { value: { alreadyPaid: false, order: { ...order, status: "paid" } } };
  }

  async listTransactions(userId, limit = 20) {
    const rows = await this.transactions
      .find({ userId }, { projection: { _id: 0 } })
      .sort({ at: -1 })
      .limit(limit)
      .toArray();
    return rows.map(({ _id, ...rest }) => rest);
  }
}
