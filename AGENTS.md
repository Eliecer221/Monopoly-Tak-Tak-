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

## Dinero real: una sola verdad y custodia

Reglas que no se negocian, porque cada una tapa un agujero que ya existió:

- **El libro contable (PostgreSQL) es la única fuente de verdad del dinero.** Si
  hay `DATABASE_URL`, el saldo que ve el juego sale de los asientos, no de
  `wallet.coins` de Mongo. Mongo sigue siendo el respaldo cuando no hay libro.
- **El servidor decide, el cliente solo informa.** Al abrir una partida, las
  reglas (entrada, jugadores, reparto) se guardan en la base. Al cerrarla, el
  servidor las vuelve a comprobar. El cliente no manda el bote, ni el ganador,
  ni los jugadores.
- **Nunca se paga más de lo que se guardó.** La custodia de una partida es la
  entrada del anfitrión. El bote nominal (entrada × jugadores) NO es dinero
  guardado: los rivales son bots. Pagar un porcentaje del bote nominal crea
  monedas de la nada, y esas monedas se pueden retirar. `test/rounds.mjs`
  comprueba que cerrar 100 partidas no crea ni una moneda.
- **Signos del libro.** Las cuentas de pasivo van en negativo. Cobrar a un
  usuario es un asiento POSITIVO; el ingreso de la casa es NEGATIVO. Equivocar
  el signo duplica el dinero en lugar de quitarlo.
- **Los límites de retiro se suman de los asientos**, no de contadores. Un
  contador puede desincronizarse; la suma siempre cuadra.
- **Las partidas con entrada real están apagadas por defecto**
  (`REAL_MONEY_ROUNDS=0`). Es dinero real y juego: hace falta licencia. Con el
  flag apagado, `/api/rounds/*` responde 503 y el juego funciona sin apostar.
  No lo enciendas sin licencia.

## GLENIS (asistente de pagos)

- **GLENIS propone, el humano decide lo irreversible.** GLENIS lee comprobantes,
  acredita los claros y arma el expediente de cada retiro, pero **no paga un
  retiro sola**: eso lo firma el administrador. No lo cambies.
- **Dos papeles, dos claves.** Visión (leer comprobantes): `OPENAI_API_KEY`,
  `GEMINI_API_KEY` o `ANTHROPIC_API_KEY`. Texto (redactar): `GROQ_API_KEY`.
- **Groq no lee imágenes.** La clave de Groq no tiene modelos de visión. Usarla
  como lector haría que GLENIS aprobara comprobantes sin leerlos. Hay una prueba
  (`test/glenis.mjs`) que lo impide. Sin clave de visión, todo va a revisión
  manual: eso es correcto, no un fallo.
- **Gemini lee los comprobantes.** `GEMINI_API_KEY` (probada contra la API real
  en `test/glenis-vision.mjs`, que se salta sin clave). Los modelos se piden por
  alias `*-latest`, nunca por nombre fijo: Google retira los fijos cada pocos
  meses y un nombre retirado deja a GLENIS ciega en silencio.
- **El rostro de GLENIS vive en `assets/glenis.jpg`** (y 128/64 px). Se usa en su
  botón y en su consola. No lo sustituyas por un emoji.
- **El registro es solo con Gmail** (`ALLOWED_EMAIL_DOMAINS`). Las pruebas que
  registran usuarios deben permitir su dominio en su propio entorno.
- **La cuenta madre** es `eliecerdepablos@gmail.com` y nace con rol `admin`. Es
  la única que reparte el rol de administrador (`/api/glenis/role`).
- **Todo queda registrado** en la colección `glenis_log`: quién, qué, confianza,
  motivo y cuándo. El panel del administrador lo muestra.

## Pruebas

- `npm test` cubre motor, servidor, interfaz, tienda, plataforma, integración,
  pagos, libro contable y partidas.
- Las pruebas del libro y de partidas necesitan PostgreSQL real
  (`DATABASE_URL`). Sin él se saltan, no fallan. En local:
  `docker compose up -d postgres`, y el puerto es el que declare el compose.
- `node --check` en cada archivo tocado antes de dar algo por terminado.
