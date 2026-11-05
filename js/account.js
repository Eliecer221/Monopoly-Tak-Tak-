// Interfaz de cuentas y tienda con pagos reales.
// El juego es gratis; aquí el jugador crea su cuenta y compra monedas, dados,
// gemas o el pase de temporada. El cobro lo hace Stripe o MercadoPago.

import { el, fmt } from "./utils.js";
import {
  apiEnabled,
  checkout,
  fetchCatalog,
  fetchTransactions,
  getToken,
  login,
  logout,
  me,
  setToken,
  signup,
} from "./api.js";

export class AccountUI {
  constructor() {
    this.user = null;
    this.catalog = [];
    this.payments = { stripe: false, mercadopago: false };
    this.bind();
    if (apiEnabled() && getToken()) this.refresh();
  }

  bind() {
    const accountBtn = document.getElementById("btn-account");
    const storeBtn = document.getElementById("btn-store");
    if (accountBtn) accountBtn.addEventListener("click", () => this.openAccount());
    if (storeBtn) storeBtn.addEventListener("click", () => this.openStore());
    for (const btn of document.querySelectorAll("[data-close-account]")) {
      btn.addEventListener("click", (e) => e.target.closest(".overlay").classList.remove("show"));
    }
    const authOverlay = document.getElementById("account-overlay");
    if (authOverlay) {
      authOverlay.addEventListener("click", (e) => {
        if (e.target.id === "account-overlay") authOverlay.classList.remove("show");
      });
    }
    const storeOverlay = document.getElementById("store-overlay");
    if (storeOverlay) {
      storeOverlay.addEventListener("click", (e) => {
        if (e.target.id === "store-overlay") storeOverlay.classList.remove("show");
      });
    }
  }

  // ---------- estado de la sesión ----------
  async refresh() {
    try {
      const data = await me();
      this.user = data.user;
    } catch {
      this.user = null;
      setToken(null);
    }
    this.renderChip();
  }

  renderChip() {
    const chip = document.getElementById("account-chip");
    if (!chip) return;
    chip.innerHTML = "";
    if (this.user) {
      chip.append(
        el("span", { class: "chip-name", text: `🪙 ${fmt(this.user.wallet.coins)}` }),
        el("span", { class: "chip-name", text: `💎 ${this.user.wallet.gems}` }),
        el("span", { class: "chip-user", text: this.user.name })
      );
    } else {
      chip.append(el("span", { class: "chip-user", text: "Invitado" }));
    }
  }

  // ---------- cuenta ----------
  openAccount() {
    if (!apiEnabled()) {
      this.toast("Las cuentas necesitan el servidor con base de datos.");
      return;
    }
    if (this.user) return this.openStore();
    this.renderAuth();
    document.getElementById("account-overlay").classList.add("show");
  }

  renderAuth(mode = "signup") {
    const box = document.getElementById("account-content");
    box.innerHTML = "";

    const title = el("h2", { class: "modal-title", text: "Tu cuenta TAK TAK" });
    const sub = el("p", {
      class: "modal-sub",
      text: "Crea una cuenta para guardar tu cartera y comprar en la tienda. El juego es gratis.",
    });

    const email = el("input", { type: "email", placeholder: "tu@correo.com", autocomplete: "email" });
    const password = el("input", { type: "password", placeholder: "Contraseña (8+ caracteres)", autocomplete: "current-password" });
    const name = el("input", { type: "text", placeholder: "Tu nombre", maxlength: "24" });

    const fields = el("div", { class: "auth-fields" }, [name, email, password]);
    if (mode === "login") fields.removeChild(name);

    const error = el("p", { class: "auth-error" });
    const submit = el("button", {
      class: "primary-btn",
      type: "button",
      text: mode === "signup" ? "Crear cuenta" : "Entrar",
    });

    submit.addEventListener("click", async () => {
      error.textContent = "";
      submit.disabled = true;
      try {
        const payload =
          mode === "signup"
            ? { email: email.value, password: password.value, name: name.value }
            : { email: email.value, password: password.value };
        const data = mode === "signup" ? await signup(payload) : await login(payload);
        setToken(data.token);
        this.user = data.user;
        this.renderChip();
        this.toast(`Bienvenido, ${data.user.name}`);
        this.renderAccountPanel();
      } catch (err) {
        error.textContent = err.message || "No se pudo completar";
      } finally {
        submit.disabled = false;
      }
    });

    const toggle = el("button", {
      class: "ghost-btn",
      type: "button",
      text: mode === "signup" ? "Ya tengo cuenta" : "Crear una cuenta",
    });
    toggle.addEventListener("click", () => this.renderAuth(mode === "signup" ? "login" : "signup"));

    box.append(title, sub, fields, error, el("div", { class: "modal-actions" }, [submit, toggle]));
  }

  renderAccountPanel() {
    const box = document.getElementById("account-content");
    box.innerHTML = "";
    const u = this.user;
    box.append(
      el("h2", { class: "modal-title", text: `Hola, ${u.name}` }),
      el("div", { class: "wallet-grid" }, [
        el("div", { class: "wallet-item" }, [
          el("span", { class: "wallet-label", text: "Monedas" }),
          el("span", { class: "wallet-value", text: `🪙 ${fmt(u.wallet.coins)}` }),
        ]),
        el("div", { class: "wallet-item" }, [
          el("span", { class: "wallet-label", text: "Gemas" }),
          el("span", { class: "wallet-value", text: `💎 ${u.wallet.gems}` }),
        ]),
        el("div", { class: "wallet-item" }, [
          el("span", { class: "wallet-label", text: "Dados" }),
          el("span", { class: "wallet-value", text: `🎲 ${u.wallet.dice}` }),
        ]),
        el("div", { class: "wallet-item" }, [
          el("span", { class: "wallet-label", text: "Compras" }),
          el("span", { class: "wallet-value", text: `${u.purchases}` }),
        ]),
      ]),
      el("p", { class: "modal-sub", text: `Sesión de ${u.email}` })
    );

    const store = el("button", { class: "primary-btn", type: "button", text: "Ir a la tienda" });
    store.addEventListener("click", () => this.openStore());
    const out = el("button", { class: "ghost-btn", type: "button", text: "Cerrar sesión" });
    out.addEventListener("click", async () => {
      try {
        await logout();
      } catch {
        /* la sesión local se limpia igual */
      }
      setToken(null);
      this.user = null;
      this.renderChip();
      document.getElementById("account-overlay").classList.remove("show");
      this.toast("Sesión cerrada");
    });
    box.append(el("div", { class: "modal-actions" }, [store, out]));
  }

  // ---------- tienda ----------
  async openStore() {
    if (!apiEnabled()) {
      this.toast("La tienda necesita el servidor con base de datos.");
      return;
    }
    if (!this.user) {
      this.renderAuth();
      document.getElementById("account-overlay").classList.add("show");
      return;
    }
    document.getElementById("store-overlay").classList.add("show");
    const box = document.getElementById("store-content");
    box.innerHTML = "";
    box.append(el("p", { class: "modal-sub", text: "Cargando la tienda…" }));
    try {
      const data = await fetchCatalog();
      this.catalog = data.products || [];
      this.payments = data.payments || {};
      await this.refresh();
    } catch (err) {
      box.innerHTML = "";
      box.append(el("p", { class: "auth-error", text: err.message || "No se pudo abrir la tienda" }));
      return;
    }
    this.renderStore();
  }

  renderStore() {
    const box = document.getElementById("store-content");
    box.innerHTML = "";
    const u = this.user;
    box.append(
      el("h2", { class: "modal-title", text: "Tienda TAK TAK" }),
      el("p", { class: "modal-sub", text: `Cartera: 🪙 ${fmt(u.wallet.coins)} · 💎 ${u.wallet.gems} · 🎲 ${u.wallet.dice}` })
    );

    const grid = el("div", { class: "shop-grid" });
    for (const p of this.catalog) {
      const card = el("div", { class: "shop-card" + (p.kind === "pass" ? " featured" : "") }, [
        el("div", { class: "shop-kind", text: this.kindIcon(p.kind) }),
        el("div", { class: "shop-name", text: p.name }),
        el("div", { class: "shop-price", text: `$${(p.priceCents / 100).toFixed(2)}` }),
      ]);
      const actions = el("div", { class: "shop-actions" });
      if (this.payments.stripe) {
        const b = el("button", { class: "primary-btn small", type: "button", text: "Tarjeta" });
        b.addEventListener("click", () => this.buy(p, "stripe"));
        actions.append(b);
      }
      if (this.payments.mercadopago) {
        const b = el("button", { class: "ghost-btn small", type: "button", text: "MercadoPago" });
        b.addEventListener("click", () => this.buy(p, "mercadopago"));
        actions.append(b);
      }
      if (!actions.children.length) {
        actions.append(el("span", { class: "shop-off", text: "Pago no disponible" }));
      }
      card.append(actions);
      grid.append(card);
    }
    box.append(grid);

    box.append(el("p", { class: "modal-sub legal", text: "Compra productos digitales para el juego. No es una apuesta: no se paga para apostar ni hay premio en metálico." }));
    this.renderHistory(box);
  }

  kindIcon(kind) {
    return { coins: "🪙", dice: "🎲", gems: "💎", pass: "🎟️" }[kind] || "🎁";
  }

  async renderHistory(box) {
    let rows = [];
    try {
      rows = (await fetchTransactions(10)).transactions || [];
    } catch {
      return;
    }
    if (!rows.length) return;
    const table = el("table", { class: "rent-table" });
    table.append(el("tr", {}, [el("th", { text: "Producto" }), el("th", { text: "Importe" }), el("th", { text: "Estado" })]));
    for (const t of rows) {
      table.append(
        el("tr", {}, [
          el("td", { text: t.productId }),
          el("td", { text: `$${(t.amountCents / 100).toFixed(2)}` }),
          el("td", { text: t.provider }),
        ])
      );
    }
    box.append(el("h3", { class: "modal-sub", text: "Tus compras" }), table);
  }

  async buy(product, provider) {
    try {
      this.toast("Abriendo la pasarela de pago…");
      const data = await checkout({ productId: product.id, provider });
      // El cobro ocurre en el proveedor; el saldo se acredita al confirmarse
      // el pago por webhook, no al volver a esta página.
      window.location.href = data.url;
    } catch (err) {
      this.toast(err.message || "No se pudo iniciar el pago");
    }
  }

  toast(text) {
    if (window.ui?.toast) window.ui.toast(text);
    else {
      const t = document.getElementById("toast");
      if (!t) return;
      t.textContent = text;
      t.classList.add("show");
      setTimeout(() => t.classList.remove("show"), 1900);
    }
  }
}
