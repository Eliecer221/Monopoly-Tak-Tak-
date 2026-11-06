// PayPal: pago manual de compras, igual que Zinli.
//
// PayPal sí tiene API, pero este flujo es manual a propósito: la app muestra el
// correo de cobro, el usuario paga desde su propia cuenta de PayPal y sube el
// comprobante. La IA lo valida y solo entonces se acreditan las monedas.
//
// El correo de cobro NO es un secreto: se muestra al pagador, como un número de
// cuenta. Nunca metas aquí contraseñas, tokens ni claves.

// Correo de cobro por defecto de la plataforma. Se puede cambiar con
// PAYPAL_RECEIVER_EMAIL sin tocar el código.
export const DEFAULT_PAYPAL_RECEIVER_EMAIL = "taktak.messenger@gmail.com";

export function paypalPayTo(env = process.env) {
  return {
    email: env.PAYPAL_RECEIVER_EMAIL || DEFAULT_PAYPAL_RECEIVER_EMAIL,
    holder: env.PAYPAL_RECEIVER_NAME || "Monopoly Tak Tak",
    note: "Envía el monto exacto a este correo de PayPal y sube el comprobante. Revisa que el destinatario coincida.",
  };
}

export function paypalConfigured(env = process.env) {
  return Boolean(env.PAYPAL_RECEIVER_EMAIL || DEFAULT_PAYPAL_RECEIVER_EMAIL);
}
