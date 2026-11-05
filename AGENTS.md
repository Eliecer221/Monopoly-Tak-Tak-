# Monopoly TAK TAK

Clon del clásico juego de mesa para el navegador. HTML, CSS y JavaScript sin
dependencias de ejecución.

## Arquitectura

- `js/engine.js` — motor de reglas, IA, subastas y tratos. No toca el DOM: emite
  eventos (`turn`, `decision`, `log`, `gameover`, ...) y pide decisiones con
  `ask()`, que usa una pila (`pendingStack`) para soportar decisiones anidadas
  (por ejemplo, un trato durante la fase de fin de turno).
- `js/ui.js` — render del tablero y modales. Consume eventos del motor.
- `js/data.js` — tablero, grupos de color y tablas de alquiler. El estado
  mutable del tablero (hipotecas y casas) vive en `BOARD`; `resetBoardState()`
  lo limpia entre partidas.
- `js/cards.js` — cartas de Suerte y Arca Común.
- `js/api.js` — cliente de la clasificación global. `apiEnabled()` decide si hay
  backend (variable `TAKTAK_API_BASE` o protocolo HTTP).
- `js/main.js` — configuración, guardado/carga y arranque.
- `server/server.mjs` — servidor HTTP y API de clasificación. `createServer()`
  acepta un `store` inyectable para las pruebas; sin `MONGODB_URI` responde 503.

## Comandos

```bash
npm run test:sim    # simulaciones headless del motor
npm run test:server # servidor y API de clasificación
npm run test:ui     # pruebas de interfaz (jsdom)
node test/integration.mjs  # interfaz + servidor + clasificación, sin mocks
npm start           # juego + clasificación (requiere MONGODB_URI)
npm run serve:static # solo el juego, sin backend
```

## Notas de mantenimiento

- El motor debe seguir siendo independiente del DOM para poder simular partidas.
- `pause()` se salta la espera cuando `speed >= 1000`; las pruebas lo usan.
- El registro de eventos se recorta a 500 entradas en el motor y 120 en la interfaz.
- Cualquier cambio de reglas necesita una aserción nueva en `test/sim.mjs`.
- La cadena de conexión de MongoDB llega por variable de entorno (`MONGODB_URI`).
  Nunca debe escribirse en el repositorio: `.env` está ignorado. El servidor
  bloquea los archivos ocultos (`.env`, `.git`) y las rutas de escape.
- La interfaz consulta la clasificación **después** de enviar la puntuación;
  invertir ese orden reintroduce una condición de carrera.
