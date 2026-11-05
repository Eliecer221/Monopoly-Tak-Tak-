# Monopoly TAK TAK

Clon del clásico juego de mesa para el navegador. HTML, CSS y JavaScript sin
dependencias de ejecución.

## Arquitectura

- `js/engine.js` — motor de reglas, IA, subastas y tratos. No toca el DOM: emite
  eventos (`turn`, `decision`, `log`, `gameover`, ...) y pide decisiones con
  `ask()`, que usa una pila (`pendingStack`) para soportar decisiones anidadas
  (por ejemplo, un trato durante la fase de fin de turno).
- `js/ui.js` — render del tablero y modales. Consume eventos del motor.
- `js/data.js` — tablero venezolano (40 casillas), grupos de color, tablas de
  alquiler, las 8 fichas de animales y la definición del Magnate (`MAGNATE`). El
  estado mutable del tablero (hipotecas y casas) vive en `BOARD`;
  `resetBoardState()` lo limpia entre partidas.
- `js/cards.js` — 32 cartas temáticas: 16 de Suerte y 16 de Caja Comunal.
- Bote **simulado**: vive en `engine.js` (`contribute`, `potTotal`, `payout`) y
  se pinta en el panel lateral de `ui.js`. No mueve dinero real y la interfaz lo
  avisa. Ver `RULES.md` para los requisitos legales.
- `js/api.js` — cliente de la API: clasificación, cuentas y tienda. `apiEnabled()`
  decide si hay backend (variable `TAKTAK_API_BASE` o protocolo HTTP). El token de
  sesión vive en `localStorage` y viaja en `Authorization: Bearer`.
- `js/account.js` — interfaz de cuenta (registro, login, cartera) y de tienda.
- `server/auth.mjs` — cuentas: contraseñas con scrypt y sal por usuario, sesiones.
- `server/store.mjs` — catálogo, órdenes y acreditación de compras.
- `server/payments.mjs` — Stripe y MercadoPago: checkout y verificación de firmas.
- `server/db.mjs` — capa de datos: MongoDB o memoria (`TAKTAK_MEMORY_DB=1`).
- `js/main.js` — configuración, guardado/carga y arranque.
- `server/server.mjs` — servidor HTTP: juego, clasificación, cuentas y tienda.
  `createServer()` acepta `store`, `db`, `env` y `fetchImpl` inyectables para las
  pruebas. Sin `MONGODB_URI` (o `db`) las cuentas y la clasificación responden 503.

## Comandos

```bash
npm run test:sim    # simulaciones headless del motor
npm run test:server # servidor y API de clasificación
npm run test:ui     # pruebas de interfaz (jsdom)
npm run test:store  # cuentas, tienda y firmas de webhook
node test/integration.mjs  # interfaz + servidor + clasificación + pagos
npm start           # juego + cuentas + tienda (requiere MONGODB_URI)
TAKTAK_MEMORY_DB=1 npm start  # cuentas y tienda en memoria, sin Atlas
npm run serve:static # solo el juego, sin backend
```

## Notas de mantenimiento

- El motor debe seguir siendo independiente del DOM para poder simular partidas.
- `pause()` se salta la espera cuando `speed >= 1000`; las pruebas lo usan.
- El registro de eventos se recorta a 500 entradas en el motor y 120 en la interfaz.
- Cualquier cambio de reglas necesita una aserción nueva en `test/sim.mjs`.
- El juego admite de 2 a 8 jugadores (`MIN_PLAYERS`/`MAX_PLAYERS` en `engine.js`).
- Las casillas de crisis suben de precio con `turnCount` (`crisisAmount`): la
  crisis empeora con el tiempo. Es intencional, no un desbalance.
- El Magnate Trumpista aparece cada `MAGNATE.everyTurns` turnos y pide una
  decisión (`type: "magnate"`) que hay que resolver con `decide("accept"|"reject")`.
- El bote es simulado. **Nunca** convertir el bote en apuesta real: exige licencia
  de juego, KYC y AML (ver `RULES.md`, sección 5).
- La tienda **sí** cobra dinero real por contenido digital. Reglas que no se
  pueden romper: el precio sale del catálogo del servidor, nunca del navegador;
  el saldo solo se acredita con la **firma verificada** del webhook; y
  `creditOrder` es idempotente, así que un webhook repetido no duplica monedas.
- Sin claves de pasarela el checkout devuelve error. Nunca debe fingir un pago.
- Las claves de Stripe y MercadoPago viven solo en el entorno. `render.yaml` las
  marca `sync: false`. No commitear ninguna.
- El modelo de negocio y los pasos de activación están en `MONETIZATION.md`.
- La cadena de conexión de MongoDB llega por variable de entorno (`MONGODB_URI`).
  Nunca debe escribirse en el repositorio: `.env` está ignorado. El servidor
  bloquea los archivos ocultos (`.env`, `.git`) y las rutas de escape.
- La interfaz consulta la clasificación **después** de enviar la puntuación;
  invertir ese orden reintroduce una condición de carrera.
- `render.yaml` define el despliegue en Render (plan gratuito, `npm start`,
  salud en `/health`). `MONGODB_URI` se marca `sync: false` para que se introduzca
  en el panel y no viaje en el repositorio.
- En el plan gratuito la instancia se duerme tras unos 15 minutos sin visitas; la
  primera petición tarda en despertar. No es un fallo.
- El móvil es el dispositivo principal, así que el bloque `@media (max-width: 620px)`
  de `css/styles.css` es parte del contrato: el modal se alinea arriba y no desborda,
  los botones de juego quedan fijos abajo (`.actions`) y los controles miden 44px o más.
  `test/ui.mjs` comprueba estas reglas para que no se pierdan.
