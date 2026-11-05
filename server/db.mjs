// Capa de datos. Usa MongoDB cuando hay MONGODB_URI; si no, memoria.
// Las pruebas y el desarrollo local funcionan sin base de datos.

const DOT = /\./;

function getPath(doc, path) {
  if (!DOT.test(path)) return doc[path];
  return path.split(".").reduce((acc, key) => (acc == null ? acc : acc[key]), doc);
}

function matches(doc, query) {
  for (const [key, expected] of Object.entries(query)) {
    if (key === "$or") {
      if (!expected.some((q) => matches(doc, q))) return false;
      continue;
    }
    const actual = getPath(doc, key);
    if (expected && typeof expected === "object" && !Array.isArray(expected)) {
      if ("$in" in expected && !expected.$in.includes(actual)) return false;
      if ("$ne" in expected && actual === expected.$ne) return false;
      continue;
    }
    if (actual !== expected) return false;
  }
  return true;
}

// Colección mínima con la misma forma que la API de MongoDB que usamos.
function memoryCollection() {
  const docs = [];
  let seq = 1;
  return {
    async insertOne(doc) {
      const _id = String(seq++);
      docs.push({ ...doc, _id });
      return { insertedId: _id };
    },
    async findOne(query) {
      return docs.find((d) => matches(d, query)) || null;
    },
    find(query = {}) {
      const state = { query, limit: Infinity, sortKey: null, dir: 1 };
      const cursor = {
        sort(spec) {
          state.sortKey = Object.keys(spec)[0];
          state.dir = spec[state.sortKey];
          return cursor;
        },
        limit(n) {
          state.limit = n;
          return cursor;
        },
        async toArray() {
          let out = docs.filter((d) => matches(d, state.query));
          if (state.sortKey) {
            out = [...out].sort((a, b) => {
              const av = getPath(a, state.sortKey);
              const bv = getPath(b, state.sortKey);
              if (av === bv) return 0;
              return (av > bv ? 1 : -1) * state.dir;
            });
          }
          return out.slice(0, state.limit);
        },
      };
      return cursor;
    },
    async updateOne(query, update) {
      const doc = docs.find((d) => matches(d, query));
      if (!doc) return { matchedCount: 0, modifiedCount: 0 };
      if (update.$set) Object.assign(doc, update.$set);
      if (update.$inc) {
        for (const [k, v] of Object.entries(update.$inc)) doc[k] = (doc[k] || 0) + v;
      }
      if (update.$push) {
        for (const [k, v] of Object.entries(update.$push)) (doc[k] ||= []).push(v);
      }
      return { matchedCount: 1, modifiedCount: 1 };
    },
    async countDocuments(query = {}) {
      return docs.filter((d) => matches(d, query)).length;
    },
    async createIndex() {},
  };
}

export function createMemoryDb() {
  const cols = new Map();
  return {
    collection(name) {
      if (!cols.has(name)) cols.set(name, memoryCollection());
      return cols.get(name);
    },
    async close() {},
  };
}

// Envuelve el cliente de MongoDB para que exponga la misma interfaz.
export function createMongoDb(client, dbName) {
  return {
    collection: (name) => client.db(dbName).collection(name),
    close: () => client.close(),
  };
}

// Índices que necesita el sistema de cuentas, pagos y cartera.
export async function ensureIndexes(db) {
  const jobs = [
    db.collection("users").createIndex({ email: 1 }, { unique: true }),
    db.collection("sessions").createIndex({ token: 1 }, { unique: true }),
    db.collection("orders").createIndex({ id: 1 }, { unique: true }),
    db.collection("orders").createIndex({ providerRef: 1 }),
    db.collection("transactions").createIndex({ userId: 1, at: -1 }),
    db.collection("transactions").createIndex({ idempotencyKey: 1 }, { unique: true, sparse: true }),
  ];
  await Promise.allSettled(jobs);
}
