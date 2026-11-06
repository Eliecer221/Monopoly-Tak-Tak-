# Cómo gana dinero Monopoly TAK TAK

Este documento explica el modelo de negocio, el catálogo, los números y lo que
falta para cobrar de verdad.

> Aviso: esto no es asesoría legal ni contable. Antes de facturar, consulta a un
> abogado y a un contador en tu país. Ver la sección 6.

## 1. El modelo: juego gratis, tienda de pago

Es el modelo de **Monopoly GO** y de casi todos los juegos móviles que facturan:
el juego es gratis y el jugador paga por **contenido digital** dentro del juego.

| | |
|---|---|
| Qué se vende | Monedas, dados, gemas y el pase de temporada |
| Quién cobra | Stripe (tarjeta) y MercadoPago (Venezuela y Latinoamérica) |
| Cuándo se cobra | Al confirmarse el pago por webhook firmado |
| Quién cobra | Tu cuenta de comercio, no la del juego |

**Por qué no hay bote con dinero real.** Un bote donde se paga para entrar y el
ganador cobra es **juego/apuesta con dinero real**. Requiere licencia de operador
de juegos, y en Venezuela eso es competencia de la **Comisión Nacional de Casinos**
(Ministerio de Interior y Justicia). Sin licencia, operar eso es ilegal, y las
pasarelas (Stripe, MercadoPago) cierran la cuenta al detectarlo. Por eso el bote
del juego es **simulado** y el dinero se gana vendiendo contenido, no apostando.

Lo que sí es legal y rentable: cobrar por monedas, dados, cosméticos y pases.

## 2. Catálogo y precios

Definido en `server/store.mjs`. Se ajusta sin tocar código de más: cambia el
precio o añade un producto a `PRODUCTS`.

| Producto | Precio | Qué entrega |
|---|---|---|
| `coins_500` | $1,99 | 500 monedas |
| `coins_1500` | $4,99 | 1.500 monedas |
| `coins_4000` | $9,99 | 4.000 monedas |
| `coins_10000` | $19,99 | 10.000 monedas |
| `dice_20` | $2,99 | 20 dados |
| `gems_100` | $4,99 | 100 gemas |
| `season_pass` | $9,99 | Pase de temporada |

El paquete grande rinde más por dólar a propósito: es el que más margen deja y el
que más se vende en este tipo de juego. El pase de temporada es el que más
fideliza, porque se renueva cada temporada.

## 3. Los números

Dos cifras mandan: **ARPDAU** (ingreso medio por usuario activo al día) y
**conversión** (qué porcentaje de jugadores paga). En juegos casuales de este
tipo la conversión suele quedar entre el 1% y el 3%, y el ARPDAU entre $0,02 y
$0,15.

Ejemplo ilustrativo con 1.000 jugadores activos al día y un ARPDAU de $0,05:

```
1.000 jugadores × $0,05            = $50 al día
                                   = ~$1.500 al mes (bruto)
Comisión de la pasarela (~3,5%)    = ~$52
Neto aproximado                    = ~$1.448 al mes
```

Son números de ejemplo, no una promesa. Lo que decide el ingreso real es la
retención: si el jugador vuelve al día siguiente, gasta. Si no vuelve, no hay
negocio, por muy bonita que sea la tienda.

### Costos fijos a cubrir

| Concepto | Costo aproximado |
|---|---|
| MongoDB Atlas (M0) | $0 mientras quepa en el plan gratuito |
| Render (plan gratuito) | $0, con la instancia dormida |
| Render (plan de pago) | desde ~$7 al mes, sin dormir |
| Pasarela | ~2,9% + $0,30 por transacción (Stripe); MercadoPago varía por país |
| Dominio propio | ~$10–15 al año |

Con el plan gratuito el punto de equilibrio es muy bajo: unas pocas ventas al
mes cubren todo. El primer gasto que vale la pena es el plan de Render de pago,
para que la tienda no tarde en despertar.

## 4. Cómo activar el cobro, paso a paso

### 4.1 Cuentas y base de datos
1. Crea un cluster en <https://cloud.mongodb.com> y copia la cadena de conexión.
2. Define `MONGODB_URI` y `MONGODB_DB` en el entorno. Sin esto no hay cuentas.

### 4.2 Stripe (tarjetas internacionales)
1. Crea la cuenta en <https://stripe.com> y completa la verificación del negocio.
2. Copia la clave secreta en `STRIPE_SECRET_KEY`.
3. Crea el webhook en **Developers → Webhooks** apuntando a
   `https://TU-DOMINIO/api/payments/webhook/stripe`, con el evento
   `checkout.session.completed`. Copia el secreto en `STRIPE_WEBHOOK_SECRET`.
4. Prueba con las claves `sk_test_...` antes de pasar a `sk_live_...`.

### 4.3 MercadoPago (Venezuela y Latinoamérica)
1. Crea la aplicación en <https://www.mercadopago.com/developers>.
2. Copia el access token en `MERCADOPAGO_ACCESS_TOKEN`.
3. Configura el webhook en `https://TU-DOMINIO/api/payments/webhook/mercadopago`
   y copia el secreto en `MERCADOPAGO_WEBHOOK_SECRET`.

### 4.4 Comprobación
```bash
npm start
curl -s localhost:3000/health
# payments.stripe y payments.mercadopago deben salir en true
```

### 4.5 Prueba local sin Atlas
```bash
TAKTAK_MEMORY_DB=1 STRIPE_SECRET_KEY=sk_test_... npm start
```
Los datos viven en memoria y se borran al reiniciar. Solo para desarrollo.

## 5. Seguridad del dinero (ya implementada)

Estas reglas están en el código y cubiertas por pruebas. No las rompas:

1. **Nunca se acredita saldo sin firma válida.** `verifyStripeSignature` y
   `verifyMercadoPagoSignature` comprueban el HMAC del webhook. Un webhook falso
   responde 400 y no toca la cartera.
2. **Cada pago se acredita una sola vez.** `creditOrder` marca la orden como
   `paid`; repetir el webhook no duplica monedas.
3. **El precio lo pone el servidor.** El cliente solo manda el `productId`. El
   importe sale del catálogo, nunca del navegador.
4. **Las contraseñas se guardan con scrypt y sal por usuario**, y se comparan en
   tiempo constante. El hash y la sal no salen en ninguna respuesta.
5. **Sin claves configuradas la tienda falla con error claro.** Nunca finge una
   compra exitosa.
6. **Cada usuario ve solo sus compras.** Las consultas filtran por `userId`.
7. **El `_id` interno de la base de datos no se filtra** en ninguna respuesta.
8. **Las claves viven en variables de entorno.** `.env` está en `.gitignore` y
   `render.yaml` marca los secretos como `sync: false`.

## 6. Lo que falta para operar de verdad

El código ya cobra. Esto es lo que falta del lado del negocio y del derecho:

| Pendiente | Por qué |
|---|---|
| Entidad legal y cuenta bancaria de comercio | Stripe y MercadoPago no pagan a cuentas personales de forma sostenible |
| Registro fiscal y facturación | Los ingresos se declaran; en Venezuela aplica el IVA |
| Términos y condiciones | Obligatorio para vender; debe describir la moneda virtual y la política de reembolsos |
| Política de privacidad | Obligatoria al tratar datos personales; ley de datos de Venezuela y, si vendes a la UE, el RGPD |
| Ley de protección al consumidor | Reglas de publicidad, precios y derecho de retracto |
| Restricción de edad | Contenido satírico y compras: exige mayoría de edad o permiso del representante |
| Reembolsos | Define una política clara y cúmplela; las pasarelas la exigen |
| Reglas de las tiendas de apps | Si publicas en Google Play o App Store, sus reglas de compra dentro de la app son obligatorias |
| Impuestos y contabilidad | Cada venta deja rastro; el historial de transacciones ya lo registra |

**Sobre el juego con dinero real:** si algún día quieres un bote real, la ruta
legal es obtener licencia de operador, integrar un procesador autorizado, aplicar
KYC y AML, y restringir por jurisdicción. Es un negocio distinto, con requisitos
muy altos, y no se hace "porque el código ya está".

## 7. Cómo crecer el ingreso

Una vez que el cobro funciona, esto es lo que más mueve la aguja, en orden:

1. **Retención diaria.** Recompensa por volver cada día y por racha. Es lo que
   sostiene el ARPDAU.
2. **Pase de temporada.** Renovable, con recompensas por nivel. El ingreso más
   predecible.
3. **Anuncios con recompensa.** Video opcional a cambio de monedas. Ingresa sin
   obligar a pagar y no molesta.
4. **Ofertas por tiempo limitado.** Paquetes con descuento tras una derrota
   ajustada. Convierte sin ser agresivo.
5. **Cosméticos.** Fichas y tableros alternativos. Cuestan poco y se venden solos.

## 8. Métricas que hay que mirar

| Métrica | Qué mide | Señal sana |
|---|---|---|
| Retención D1 / D7 | Si el jugador vuelve | D1 sobre 30% |
| Conversión | Porcentaje que paga | 1%–3% |
| ARPDAU | Ingreso por usuario al día | $0,02–$0,15 |
| ARPPU | Gasto medio del que paga | $5–$20 |
| Ingreso por temporada | Fuerza del pase | Sube cada temporada |

## 9. Resumen

El juego es gratis y se gana dinero vendiendo contenido digital con **pagos
reales** por Stripe y MercadoPago, sobre **cuentas de usuario reales**. El bote
sigue siendo simulado porque el bote real es apuesta y exige licencia. El código
ya cobra, acredita una sola vez y protege el saldo; lo que falta es la parte
legal, fiscal y de negocio.
