// Cliente de la API: clasificación, cuentas de usuario y tienda con pagos.
// Si no hay backend, el juego funciona igual y estas funciones avisan.

const API_BASE = (typeof window !== "undefined" && window.TAKTAK_API_BASE) || "";
const TOKEN_KEY = "monopoly-tak-tak-token";

export function apiEnabled() {
  if (API_BASE) return true;
  if (typeof window === "undefined") return false;
  return /^https?:$/.test(window.location?.protocol || "");
}

export function getToken() {
  try {
    return window.localStorage?.getItem(TOKEN_KEY) || null;
  } catch {
    return null;
  }
}

export function setToken(token) {
  try {
    if (token) window.localStorage.setItem(TOKEN_KEY, token);
    else window.localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* almacenamiento no disponible */
  }
}

async function request(path, options = {}) {
  const token = getToken();
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data;
}

export async function fetchLeaderboard(limit = 10) {
  const data = await request(`/api/leaderboard?limit=${limit}`);
  return Array.isArray(data?.scores) ? data.scores : [];
}

export function submitScore(entry) {
  return request("/api/scores", { method: "POST", body: JSON.stringify(entry) });
}

// ---------- cuentas ----------
export function signup({ email, password, name }) {
  return request("/api/auth/signup", { method: "POST", body: JSON.stringify({ email, password, name }) });
}

export function login({ email, password }) {
  return request("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
}

export function me() {
  return request("/api/auth/me");
}

export function logout() {
  return request("/api/auth/logout", { method: "POST", body: "{}" });
}

// ---------- tienda ----------
export function fetchCatalog() {
  return request("/api/store/catalog");
}

export function checkout({ productId, provider }) {
  return request("/api/store/checkout", {
    method: "POST",
    body: JSON.stringify({ productId, provider }),
  });
}

export function fetchTransactions(limit = 20) {
  return request(`/api/store/transactions?limit=${limit}`);
}

export function fetchOrders() {
  return request("/api/store/orders");
}
