// Cliente de la clasificación global.
// Si no hay backend configurado, el juego funciona igual y la clasificación
// aparece como no disponible.

const API_BASE =
  (typeof window !== "undefined" && window.TAKTAK_API_BASE) || "";

// La clasificación vive en el mismo origen cuando el juego se sirve con
// `node server/server.mjs`. Si se abre como archivo suelto, no hay backend.
export function apiEnabled() {
  if (API_BASE) return true;
  if (typeof window === "undefined") return false;
  return /^https?:$/.test(window.location?.protocol || "");
}

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function fetchLeaderboard(limit = 10) {
  const data = await request(`/api/leaderboard?limit=${limit}`);
  return Array.isArray(data?.scores) ? data.scores : [];
}

export function submitScore(entry) {
  return request("/api/scores", { method: "POST", body: JSON.stringify(entry) });
}
