// Interfaz de cuentas y tienda con pagos reales.
// El juego es gratis; aquí el jugador crea su cuenta y compra monedas, dados,
// gemas o el pase de temporada. El cobro se hace por PayPal (pago manual con
// comprobante); Stripe y MercadoPago siguen disponibles en el servidor.

import { el, fmt, readImageAsDataUrl } from "./utils.js";
import {
  apiEnabled,
  fetchCatalog,
  fetchTransactions,
  getToken,
  glenisDecide,
  glenisLog,
  glenisSetRole,
  glenisStatus,
  glenisWithdrawals,
  login,
  logout,
  me,
  paypalOrder,
  paypalQuote,
  paypalReceipt,
  setToken,
  signup,
} from "./api.js";

export class AccountUI {
  constructor() {
    this.user = null;
    this.catalog = [];
    this.payments = { paypal: false, stripe: false, mercadopago: false };
    this.bind();
    if (apiEnabled() && getToken()) this.refresh();
  }

  bind() {
    const accountBtn = document.getElementById("btn-account");
    const storeBtn = document.getElementById("btn-store");
    const glenisBtn = document.getElementById("btn-glenis");
    if (accountBtn) accountBtn.addEventListener("click", () => this.openAccount());
    if (storeBtn) storeBtn.addEventListener("click", () => this.openStore());
    if (glenisBtn) glenisBtn.addEventListener("click", () => this.openGlenis());
    const glenisOverlay = document.getElementById("glenis-overlay");
    if (glenisOverlay) {
      glenisOverlay.addEventListener("click", (e) => {
        if (e.target.id === "glenis-overlay") glenisOverlay.classList.remove("show");
      });
    }
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
    // El botón de GLENIS solo lo ve quien administra.
    const glenisBtn = document.getElementById("btn-glenis");
    if (glenisBtn) glenisBtn.hidden = this.user?.role !== "admin";
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
      text:
        mode === "signup"
          ? "Regístrate con tu correo de Gmail para guardar tu cartera y comprar en la tienda. El juego es gratis."
          : "Entra con tu correo y contraseña.",
    });

    const email = el("input", {
      type: "email",
      placeholder: mode === "signup" ? "tucorreo@gmail.com" : "tu@correo.com",
      autocomplete: "email",
    });
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
    const glenis = el("button", { class: "ghost-btn glenis", type: "button" }, [
      el("img", { class: "glenis-face", src: "assets/glenis-64.jpg", alt: "", width: "24", height: "24" }),
      "GLENIS",
    ]);
    glenis.addEventListener("click", () => this.openGlenis());
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
    const actions = [store, out];
    if (u.role === "admin") actions.unshift(glenis);
    box.append(el("div", { class: "modal-actions" }, actions));
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
      if (this.payments.paypal) {
        const b = el("button", { class: "primary-btn small", type: "button", text: "PayPal" });
        b.addEventListener("click", () => this.openPaypal(p));
        actions.append(b);
      } else {
        actions.append(el("span", { class: "shop-off", text: "Pago no disponible" }));
      }
      card.append(actions);
      grid.append(card);
    }
    box.append(grid);

    box.append(el("p", { class: "modal-sub legal", text: "Compra productos digitales para el juego. No es una apuesta: no se paga para apostar ni hay premio en metálico." }));
    this.renderHistory(box);
  }

  // ---------- PayPal: pago manual ----------
  // La app muestra el correo de cobro; el usuario paga desde su cuenta de PayPal
  // y sube el comprobante. Las monedas se acreditan al validarse el comprobante.
  // El correo se muestra ANTES de crear la orden para que el usuario siempre
  // sepa a dónde pagar, aunque todavía no pueda comprar (KYC, límites).
  async openPaypal(product) {
    const box = document.getElementById("store-content");
    box.innerHTML = "";
    box.append(
      el("h2", { class: "modal-title", text: "Pagar con PayPal" }),
      el("p", { class: "modal-sub", text: `${product.name} · $${(product.priceCents / 100).toFixed(2)}` })
    );

    let pay = {};
    try {
      const quote = await paypalQuote();
      pay = quote.pay || {};
    } catch {
      pay = {};
    }
    const amount = `$${(product.priceCents / 100).toFixed(2)}`;
    box.append(
      el("div", { class: "pay-box" }, [
        el("span", { class: "pay-label", text: "Correo de PayPal para el pago" }),
        el("span", { class: "pay-email", text: pay.email || "" }),
        el("span", { class: "pay-amount", text: `Monto exacto: ${amount}` }),
        el("span", { class: "pay-note", text: pay.note || "Envía el monto exacto y sube el comprobante." }),
      ])
    );

    const file = el("input", { type: "file", accept: "image/*" });
    const ref = el("input", { type: "text", placeholder: "Referencia o número de transacción (opcional)" });
    const send = el("button", { class: "primary-btn", type: "button", text: "Ya pagué, subir comprobante" });
    const status = el("p", { class: "modal-note", text: "" });

    send.addEventListener("click", async () => {
      const f = file.files?.[0];
      if (!f) {
        status.textContent = "Adjunta una captura del comprobante de PayPal.";
        status.className = "auth-error";
        return;
      }
      send.disabled = true;
      status.className = "modal-note";
      status.textContent = "Revisando el comprobante…";
      try {
        const image = await readImageAsDataUrl(f);
        const order = await paypalOrder({ productId: product.id });
        const res = await paypalReceipt({ orderId: order.orderId, image, reference: ref.value });
        if (res.verdict === "approved") {
          await this.refresh();
          box.innerHTML = "";
          box.append(
            el("h2", { class: "modal-title", text: "¡Pago acreditado!" }),
            el("p", { class: "modal-sub", text: `${product.name} ya está en tu cartera.` }),
            this.backToStoreButton()
          );
        } else if (res.verdict === "manual_review") {
          status.className = "modal-note";
          status.textContent = "Tu comprobante quedó en revisión. GLENIS lo confirma en breve.";
          send.disabled = false;
        } else {
          status.className = "auth-error";
          status.textContent = `No se pudo validar: ${(res.reasons || []).join("; ") || "comprobante no reconocido"}`;
          send.disabled = false;
        }
      } catch (err) {
        status.className = "auth-error";
        status.textContent = err.message || "No se pudo enviar el comprobante";
        send.disabled = false;
      }
    });

    box.append(
      el("div", { class: "pay-form" }, [
        el("label", { class: "field" }, [el("span", { text: "Comprobante" }), file]),
        el("label", { class: "field" }, [el("span", { text: "Referencia" }), ref]),
        send,
        status,
      ]),
      this.backToStoreButton()
    );
  }

  backToStoreButton() {
    const back = el("button", { class: "ghost-btn", type: "button", text: "Volver a la tienda" });
    back.addEventListener("click", () => this.openStore());
    return el("div", { class: "modal-actions" }, [back]);
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

  // ---------- GLENIS: consola del administrador ----------
  async openGlenis() {
    if (!apiEnabled()) {
      this.toast("GLENIS necesita el servidor con base de datos.");
      return;
    }
    if (this.user?.role !== "admin") {
      this.toast("Solo la cuenta madre y sus administradores entran aquí.");
      return;
    }
    document.getElementById("glenis-overlay").classList.add("show");
    const box = document.getElementById("glenis-content");
    box.innerHTML = "";
    box.append(el("p", { class: "modal-sub", text: "GLENIS está revisando los pagos…" }));
    try {
      const [status, log, withdrawals] = await Promise.all([
        glenisStatus(),
        glenisLog(),
        glenisWithdrawals(),
      ]);
      this.glenis = { status, log, withdrawals };
    } catch (err) {
      box.innerHTML = "";
      box.append(el("p", { class: "auth-error", text: err.message || "GLENIS no respondió" }));
      return;
    }
    this.renderGlenis();
  }

  renderGlenis() {
    const box = document.getElementById("glenis-content");
    const { status, log, withdrawals } = this.glenis;
    box.innerHTML = "";

    const vision = status.vision
      ? `lee los comprobantes con ${status.vision}`
      : "sin lector de comprobantes";
    const text = status.text ? `redacta con ${status.text}` : "sin redacción propia";
    if (!status.vision) {
      box.append(
        el("p", {
          class: "auth-error",
          text:
            "GLENIS no tiene lector de comprobantes: sin una clave de visión (OpenAI, Gemini o Anthropic), no puede leer las capturas y TODOS los pagos van a revisión manual. La clave de Groq sirve para redactar, no para leer imágenes.",
        })
      );
    }

    const portrait = el("img", {
      class: "glenis-portrait",
      src: "assets/glenis-128.jpg",
      alt: "GLENIS, asistente de pagos",
      width: "64",
      height: "64",
    });
    box.append(
      el("div", { class: "glenis-head" }, [
        portrait,
        el("div", { class: "glenis-head-text" }, [
          el("span", { class: "glenis-name", text: "GLENIS" }),
          el("span", { class: "glenis-tag", text: "Asistente de pagos y control" }),
        ]),
      ]),
      el("p", {
        class: "modal-sub",
        text: `${status.enabled ? "Encendida" : "Apagada"}: ${vision}, ${text}.`,
      }),
      el("p", {
        class: "modal-note",
        text: `GLENIS valida los comprobantes y arma el expediente de cada retiro, pero no paga sola: tú decides lo irreversible. Aprueba hasta ${status.autoApproveLimit} comprobantes al día por su cuenta; al pasarlos, todo va a revisión.`,
      })
    );

    const s = log.summary || {};
    box.append(
      el("div", { class: "wallet-grid" }, [
        el("div", { class: "wallet-item" }, [
          el("span", { class: "wallet-label", text: "Decisiones" }),
          el("span", { class: "wallet-value", text: `${s.total || 0}` }),
        ]),
        el("div", { class: "wallet-item" }, [
          el("span", { class: "wallet-label", text: "Aprobadas" }),
          el("span", { class: "wallet-value", text: `${s.approved || 0}` }),
        ]),
        el("div", { class: "wallet-item" }, [
          el("span", { class: "wallet-label", text: "Rechazadas" }),
          el("span", { class: "wallet-value", text: `${s.rejected || 0}` }),
        ]),
        el("div", { class: "wallet-item" }, [
          el("span", { class: "wallet-label", text: "A revisar" }),
          el("span", { class: "wallet-value", text: `${s.manual || 0}` }),
        ]),
      ])
    );

    // Expedientes de retiro.
    const cases = withdrawals.cases || [];
    box.append(el("h3", { class: "modal-sub", text: `Retiros pendientes (${cases.length})` }));
    if (!cases.length) {
      box.append(el("p", { class: "modal-note", text: "No hay retiros esperando decisión." }));
    }
    for (const c of cases) {
      const card = el("div", { class: "shop-card" }, [
        el("div", { class: "shop-name", text: `${c.email} · 🪙 ${fmt(c.gross)}` }),
        el("div", {
          class: "shop-price",
          text: `Recibe ${fmt(c.net)} · confianza ${(c.score * 100).toFixed(0)}%`,
        }),
      ]);
      if (c.risks.length) {
        card.append(el("p", { class: "auth-error", text: "Señales: " + c.risks.join("; ") }));
      } else {
        card.append(el("p", { class: "modal-note", text: "Sin señales de riesgo. Recomendación: parece correcto." }));
      }
      if (c.explanation) {
        card.append(el("p", { class: "modal-note", text: `GLENIS: ${c.explanation}` }));
      }
      const actions = el("div", { class: "shop-actions" });
      const pay = el("button", { class: "primary-btn small", type: "button", text: "Marcar pagado" });
      pay.addEventListener("click", () => this.decideGlenis("withdrawal", c.id, true, "pagado por el administrador"));
      const no = el("button", { class: "ghost-btn small danger", type: "button", text: "Rechazar" });
      no.addEventListener("click", () => this.decideGlenis("withdrawal", c.id, false, "rechazado por el administrador"));
      actions.append(pay, no);
      card.append(actions);
      box.append(card);
    }

    // Dar o quitar el rol de administrador.
    const roleBox = el("div", { class: "field" });
    const roleInput = el("input", { type: "email", placeholder: "correo@gmail.com" });
    const roleBtn = el("button", { class: "ghost-btn small", type: "button", text: "Hacer administrador" });
    roleBtn.addEventListener("click", async () => {
      try {
        await glenisSetRole({ email: roleInput.value, role: "admin" });
        this.toast("Rol de administrador concedido");
        this.openGlenis();
      } catch (err) {
        this.toast(err.message || "No se pudo cambiar el rol");
      }
    });
    roleBox.append(el("span", { text: "Dar acceso de administración" }), roleInput, roleBtn);
    box.append(el("h3", { class: "modal-sub", text: "Administradores" }), roleBox);

    // Registro de decisiones.
    const entries = log.entries || [];
    box.append(el("h3", { class: "modal-sub", text: "Registro de GLENIS" }));
    if (!entries.length) {
      box.append(el("p", { class: "modal-note", text: "Todavía no hay decisiones registradas." }));
    }
    const table = el("table", { class: "rent-table" });
    table.append(
      el("tr", {}, [
        el("th", { text: "Cuándo" }),
        el("th", { text: "Quién" }),
        el("th", { text: "Qué" }),
        el("th", { text: "Decisión" }),
        el("th", { text: "Motivo" }),
      ])
    );
    for (const e of entries) {
      table.append(
        el("tr", {}, [
          el("td", { text: new Date(e.at).toLocaleString("es-VE") }),
          el("td", { text: e.actor }),
          el("td", { text: e.action }),
          el("td", { text: e.decision }),
          el("td", { text: (e.reasons || []).join("; ").slice(0, 90) }),
        ])
      );
    }
    box.append(table);
  }

  async decideGlenis(kind, id, approve, note) {
    try {
      await glenisDecide({ kind, id, approve, note });
      this.toast(approve ? "Marcado como pagado" : "Rechazado");
      await this.refresh();
      await this.openGlenis();
    } catch (err) {
      this.toast(err.message || "No se pudo completar la decisión");
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
