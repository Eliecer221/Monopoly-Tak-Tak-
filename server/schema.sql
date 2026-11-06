-- Esquema financiero transaccional con libro contable de doble partida.
--
-- Principios:
--   1. Todo asiento tiene suma cero. Un trigger diferido lo comprueba al confirmar.
--   2. El saldo es la suma de los asientos, no un campo que se sobrescribe.
--   3. Cada operación lleva una clave de idempotencia única.
--   4. Las reservas usan SELECT ... FOR UPDATE sobre la fila del saldo.
--   5. El outbox guarda los efectos externos para que no se pierdan ni se repitan.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------- cuentas ----------
-- kind:
--   asset     lo que la plataforma tiene (dinero en Zinli, efectivo)
--   liability lo que la plataforma debe (monedas de los usuarios)
--   revenue   ingreso de la plataforma
--   expense   costo de la plataforma
--   equity    capital
CREATE TABLE IF NOT EXISTS accounts (
  id          bigserial PRIMARY KEY,
  project_id  text NOT NULL,
  user_id     text,
  kind        text NOT NULL CHECK (kind IN ('asset','liability','revenue','expense','equity')),
  asset_id    text NOT NULL,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Una sola cuenta por usuario, tipo y activo. Las cuentas de sistema (user_id
-- nulo) se distinguen por el nombre.
CREATE UNIQUE INDEX IF NOT EXISTS accounts_user_uniq
  ON accounts (project_id, user_id, asset_id, kind)
  WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS accounts_system_uniq
  ON accounts (project_id, asset_id, kind, name)
  WHERE user_id IS NULL;

-- ---------- asientos ----------
-- posting_key es la clave de idempotencia: repetirla no crea un segundo asiento.
CREATE TABLE IF NOT EXISTS journals (
  id           bigserial PRIMARY KEY,
  project_id   text NOT NULL,
  posting_key  text NOT NULL,
  memo         text NOT NULL DEFAULT '',
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, posting_key)
);

CREATE TABLE IF NOT EXISTS postings (
  id          bigserial PRIMARY KEY,
  journal_id  bigint NOT NULL REFERENCES journals(id) ON DELETE RESTRICT,
  account_id  bigint NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  -- Positivo = aumenta el saldo de la cuenta, negativo = lo disminuye.
  amount      bigint NOT NULL CHECK (amount <> 0),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS postings_account_idx ON postings (account_id, id);
CREATE INDEX IF NOT EXISTS postings_journal_idx ON postings (journal_id);

-- Todo asiento debe sumar cero. Diferido: se comprueba al confirmar la
-- transacción, no en cada INSERT.
CREATE OR REPLACE FUNCTION check_journal_balanced() RETURNS trigger AS $$
DECLARE
  total bigint;
  rows_count integer;
BEGIN
  SELECT COALESCE(SUM(amount), 0), COUNT(*) INTO total, rows_count
  FROM postings WHERE journal_id = NEW.journal_id;

  IF rows_count < 2 THEN
    RAISE EXCEPTION 'asiento % tiene menos de dos partidas', NEW.journal_id;
  END IF;

  IF total <> 0 THEN
    RAISE EXCEPTION 'asiento % no cuadra: suma %', NEW.journal_id, total;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS postings_balanced ON postings;
CREATE CONSTRAINT TRIGGER postings_balanced
  AFTER INSERT ON postings
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION check_journal_balanced();

-- Los asientos no se modifican ni se borran: se compensan con uno nuevo.
CREATE OR REPLACE FUNCTION forbid_posting_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'los asientos son inmutables';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS postings_immutable ON postings;
CREATE TRIGGER postings_immutable
  BEFORE UPDATE OR DELETE ON postings
  FOR EACH ROW EXECUTE FUNCTION forbid_posting_mutation();

-- ---------- saldos ----------
-- Caché del saldo para poder bloquear la fila con FOR UPDATE. La verdad sigue
-- siendo la suma de postings; esto se actualiza en la misma transacción.
CREATE TABLE IF NOT EXISTS balances (
  account_id  bigint PRIMARY KEY REFERENCES accounts(id) ON DELETE RESTRICT,
  amount      bigint NOT NULL DEFAULT 0,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------- compras ----------
CREATE TABLE IF NOT EXISTS purchases (
  id              bigserial PRIMARY KEY,
  project_id      text NOT NULL,
  order_id        text NOT NULL,
  user_id         text NOT NULL,
  product_id      text NOT NULL,
  amount_cents    integer NOT NULL CHECK (amount_cents > 0),
  status          text NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','paid','rejected','refunded')),
  reference       text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  paid_at         timestamptz,
  UNIQUE (project_id, order_id)
);

CREATE INDEX IF NOT EXISTS purchases_user_idx ON purchases (project_id, user_id, created_at DESC);

-- ---------- reservas ----------
-- Una reserva aparta monedas sin gastarlas. Se libera o se consume una sola vez.
CREATE TABLE IF NOT EXISTS reservations (
  id            bigserial PRIMARY KEY,
  project_id    text NOT NULL,
  user_id       text NOT NULL,
  asset_id      text NOT NULL,
  amount        bigint NOT NULL CHECK (amount > 0),
  status        text NOT NULL DEFAULT 'held'
                  CHECK (status IN ('held','consumed','released')),
  reason        text NOT NULL DEFAULT '',
  created_at    timestamptz NOT NULL DEFAULT now(),
  closed_at     timestamptz
);

CREATE INDEX IF NOT EXISTS reservations_user_idx ON reservations (project_id, user_id, status);

-- ---------- retiros ----------
CREATE TABLE IF NOT EXISTS withdrawals (
  id                bigserial PRIMARY KEY,
  project_id        text NOT NULL,
  withdrawal_id     text NOT NULL,
  user_id           text NOT NULL,
  asset_id          text NOT NULL,
  amount            bigint NOT NULL CHECK (amount > 0),
  fee               bigint NOT NULL DEFAULT 0 CHECK (fee >= 0),
  net               bigint NOT NULL CHECK (net > 0),
  destination_token text NOT NULL,
  idempotency_key   text NOT NULL,
  status            text NOT NULL DEFAULT 'requested'
                      CHECK (status IN ('requested','processing','paid','rejected')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  decided_at        timestamptz,
  UNIQUE (project_id, withdrawal_id),
  -- La idempotencia es del usuario: repetir la clave no crea un segundo retiro.
  UNIQUE (project_id, user_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS withdrawals_status_idx ON withdrawals (project_id, status, created_at);

-- ---------- outbox ----------
-- Efectos externos (avisar a Zinli, mandar un correo). Se escriben en la misma
-- transacción que el asiento, para que no exista un asiento sin su efecto ni al
-- contrario. Un worker los procesa con reintentos.
CREATE TABLE IF NOT EXISTS outbox (
  id            bigserial PRIMARY KEY,
  project_id    text NOT NULL,
  topic         text NOT NULL,
  payload       jsonb NOT NULL,
  dedupe_key    text NOT NULL,
  status        text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','processing','done','failed')),
  attempts      integer NOT NULL DEFAULT 0,
  last_error    text,
  available_at  timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  processed_at  timestamptz,
  UNIQUE (project_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS outbox_pending_idx ON outbox (status, available_at)
  WHERE status IN ('pending','processing');

-- ---------- conciliación ----------
CREATE TABLE IF NOT EXISTS reconciliations (
  id             bigserial PRIMARY KEY,
  project_id     text NOT NULL,
  asset_id       text NOT NULL,
  ledger_total   bigint NOT NULL,
  external_total bigint NOT NULL,
  difference     bigint NOT NULL,
  ok             boolean NOT NULL,
  detail         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- ---------- auditoría ----------
CREATE TABLE IF NOT EXISTS audit_log (
  id          bigserial PRIMARY KEY,
  project_id  text NOT NULL,
  actor_id    text,
  action      text NOT NULL,
  target      text,
  detail      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_log_idx ON audit_log (project_id, created_at DESC);
