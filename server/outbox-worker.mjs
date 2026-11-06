// Worker del outbox.
//
// Procesa los efectos externos pendientes (avisar a Zinli, mandar un correo) con
// reintentos y espera creciente. Los efectos se escriben en la misma transacción
// que el asiento, así que no puede quedar un movimiento contable sin su aviso.
//
// El worker es idempotente: si el proceso muere tras enviar el aviso pero antes
// de marcarlo, al reintentar el efecto se repite. Por eso cada manejador debe
// ser idempotente por su `dedupeKey`.

export class OutboxWorker {
  constructor(repo, handlers, { logger = console, maxAttempts = 5 } = {}) {
    this.repo = repo;
    this.handlers = handlers;
    this.logger = logger;
    this.maxAttempts = maxAttempts;
    this.stopped = true;
    this.timer = null;
  }

  // Procesa un lote. Devuelve cuántos efectos se atendieron.
  async runOnce(limit = 10) {
    const claimed = await this.repo.claimOutbox(limit);
    for (const item of claimed) {
      const handler = this.handlers[item.topic];
      try {
        if (!handler) throw new Error(`no hay manejador para ${item.topic}`);
        await handler(item.payload, item);
        await this.repo.completeOutbox(item.id);
        this.logger.log(`outbox ${item.id} ${item.topic} ok`);
      } catch (err) {
        await this.repo.failOutbox(item.id, err?.message || String(err), this.maxAttempts);
        this.logger.warn(`outbox ${item.id} ${item.topic} falló: ${err?.message || err}`);
      }
    }
    return claimed.length;
  }

  start({ intervalMs = 2000, limit = 10 } = {}) {
    if (!this.stopped) return;
    this.stopped = false;
    const tick = async () => {
      if (this.stopped) return;
      try {
        await this.runOnce(limit);
      } catch (err) {
        this.logger.error(`outbox: ${err?.message || err}`);
      }
      if (!this.stopped) this.timer = setTimeout(tick, intervalMs);
    };
    this.timer = setTimeout(tick, 0);
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
