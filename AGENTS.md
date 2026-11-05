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
- `js/main.js` — configuración, guardado/carga y arranque.

## Comandos

```bash
npm test          # simulaciones headless del motor
npm install --no-save jsdom && npm run test:ui   # pruebas de interfaz
python3 -m http.server 8000                      # jugar en local
```

## Notas de mantenimiento

- El motor debe seguir siendo independiente del DOM para poder simular partidas.
- `pause()` se salta la espera cuando `speed >= 1000`; las pruebas lo usan.
- El registro de eventos se recorta a 500 entradas en el motor y 120 en la interfaz.
- Cualquier cambio de reglas necesita una aserción nueva en `test/sim.mjs`.
