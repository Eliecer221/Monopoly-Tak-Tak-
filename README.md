# 🎩 Monopoly TAK TAK

Clon del clásico juego de mesa para el navegador, con temática **venezolana**:
la crisis, los apagones, el mercado cambiario y **El Magnate Trumpista**.
Sin dependencias de ejecución: abre `index.html` y juega.

![estado](https://img.shields.io/badge/estado-jugable-35d07f)

**Jugar en línea:** <https://eliecer221.github.io/Monopoly-Tak-Tak-/>

## ✨ Características

- **Tablero de 40 casillas** ambientado en Venezuela: PDVSA, Corpoelec, Cantv, ministerios,
  4 transportes y 4 casillas de **crisis** (apagones, agua, cambio, deuda).
- **2 a 8 jugadores** en el mismo dispositivo: cada uno puede ser humano o IA.
- **8 fichas de animales venezolanos**: Turpial, Jaguar, Chigüire, Tonina, Oso Frontino,
  Caimán del Orinoco, Guacamaya y Mono Araguato.
- **El Magnate Trumpista**: aparece cada 12 turnos con un "deal" que aceptar o rechazar.
- **Bote simulado** con buy-in ajustable ($0–$50), recargas y reparto 60% ganador / 40% casa.
- **IA** que compra, construye, hipoteca, puja en subastas y **propone tratos** para completar monopolios.
- **Reglas clásicas**: alquileres escalados, grupos de color, construcción equilibrada, hoteles,
  hipotecas con interés, cárcel, dobles, impuestos, Suerte y Caja Comunal.
- **32 cartas temáticas** con la actualidad venezolana.
- **Subastas** cuando un jugador rechaza comprar.
- **Tratos** entre jugadores: intercambio de propiedades y efectivo con previsualización.
- **Guardado local** de la partida en el navegador.
- **Clasificación global** de mejores partidas, guardada en MongoDB Atlas.
- Interfaz responsive con animaciones, registro de eventos y detalles de cada propiedad.

## 🚀 Cómo jugar

### Con clasificación global (recomendado)

El servidor sirve el juego y guarda las mejores partidas en MongoDB:

```bash
npm install
MONGODB_URI="mongodb+srv://..." npm start
```

Abre <http://localhost:3000>. Cuando ganas, tu puntuación se envía sola y el modal
muestra la clasificación. La cadena de conexión llega por variable de entorno y
**nunca se guarda en el repositorio** (`.env` está en `.gitignore`; usa `.env.example`
como plantilla).

Sin `MONGODB_URI` el servidor funciona igual y la clasificación aparece como no disponible.

### Solo el juego (sin backend)

Necesitas servir los archivos por HTTP (los módulos ES no funcionan con `file://`):

```bash
python3 -m http.server 8000
```

Luego abre <http://localhost:8000> en el navegador.

## 🔌 API

| Ruta | Método | Qué hace |
| --- | --- | --- |
| `/api/leaderboard?limit=10` | GET | Devuelve las mejores puntuaciones (límite 1–50) |
| `/api/scores` | POST | Guarda una puntuación `{name, netWorth, turns, players}` |

El servidor valida los datos, limita el tamaño de las peticiones y aplica un tope de
10 envíos por minuto y dirección. Los archivos ocultos (`.env`, `.git`) nunca se sirven.

## 🎮 Reglas implementadas

| Elemento | Comportamiento |
| --- | --- |
| Salida | Cobras $200 al pasar |
| Propiedades | Se compran al caer; si rechazas, van a subasta |
| Grupo de color | Alquiler base ×2 sin casas; permite construir |
| Construcción | Equilibrada: no puedes sacar más de 1 casa de ventaja |
| Transportes | Alquiler $25 / $50 / $100 / $200 según cuántos poseas |
| Crisis | 4 casillas que cobran al caer; el costo sube 25% cada 40 turnos |
| Magnate | Aparece cada 12 turnos con un deal; aceptar o rechazar tiene consecuencias |
| Bote | Simulado: 60% ganador, 40% casa. No mueve dinero real |
| Hipoteca | Recibes la mitad del precio; recuperar cuesta +10% |
| Cárcel | Pagas $50, usas carta o sacas dobles; tras 3 turnos pagas |
| Dobles | Repites turno; tres dobles seguidos te llevan a la cárcel |
| Bancarrota | Si no puedes pagar ni hipotecando, tus bienes pasan al acreedor |

## 🧪 Pruebas

El motor es agnóstico de la interfaz y se prueba de forma headless:

```bash
npm run test:sim    # simulaciones headless del motor
npm run test:server # servidor y API de clasificación
npm run test:ui     # interfaz sobre jsdom
node test/integration.mjs   # interfaz + servidor + clasificación, sin mocks
```

La suite del motor juega 60 partidas completas con IA (verificando invariantes: dinero no
negativo, propiedades sin duplicados, construcciones equilibradas), ejercita los caminos de
decisión humanos (tiradas, compras, subastas, cárcel, recaudación y tratos) y valida
alquileres, hipotecas, bancarrota, tratos, subastas y el guardado.

La suite del servidor comprueba la validación de puntuaciones, el orden de la clasificación,
los límites, el servido de archivos y que los archivos ocultos y las rutas de escape quedan
bloqueados.

La suite de interfaz simula pulsaciones reales de botones sobre un DOM simulado y juega
una partida completa con un generador de números determinista. También comprueba el tablero
de 8 jugadores, el bote y el reparto 60/40.

Las reglas completas, la tabla de precios, las 32 cartas, el diseño del tablero y los
requisitos legales del sistema de pagos están en **[RULES.md](RULES.md)**.

La prueba de integración arranca el servidor de verdad, envía la puntuación por HTTP y
comprueba que se guarda y se muestra en el modal del ganador.

## 🗂️ Estructura

```
index.html         Interfaz
css/styles.css     Estilos
js/data.js         Tablero venezolano, fichas, precios y El Magnate
js/cards.js        Cartas de Suerte y Caja Comunal
js/engine.js       Motor de reglas, IA, subastas y tratos
js/ui.js           Render del tablero y modales
js/api.js          Cliente de la clasificación global
js/main.js         Configuración y arranque
server/server.mjs  Servidor HTTP y API de clasificación (MongoDB)
test/sim.mjs       Pruebas headless del motor
test/server.mjs    Pruebas del servidor y la API
test/ui.mjs        Pruebas de interfaz con jsdom
test/integration.mjs  Pruebas de integración de extremo a extremo
```

## ☁️ Despliegue en Render

El repositorio incluye `render.yaml`, así que el despliegue es casi automático:

1. Entra en <https://render.com> y crea una cuenta (puedes entrar con GitHub).
2. Pulsa **New → Blueprint** y elige el repositorio `Monopoly-Tak-Tak-`.
3. Render lee `render.yaml` y pide el valor de `MONGODB_URI`. Pega ahí la cadena de
   conexión de MongoDB Atlas (la misma que usas en local). No la escribas en el repositorio.
4. Pulsa **Apply**. Cuando termine, tendrás una URL del tipo
   `https://monopoly-tak-tak.onrender.com`.

La app arranca con `npm start`, expone `/health` para la comprobación de vida y sirve
el juego y la clasificación en el mismo dominio, así que no hace falta configurar nada
en el cliente.

### Alternativa sin `render.yaml`

Si prefieres crearlo a mano: **New → Web Service**, conecta el repositorio y usa
`npm install` como comando de construcción, `npm start` como comando de arranque y
`/health` como ruta de salud. Añade `MONGODB_URI` en **Environment**.

### Aviso del plan gratuito

En el plan gratuito la instancia se **duerme tras unos 15 minutos sin visitas**; la
primera visita después tarda unos 30–60 segundos en responder. Es normal y no afecta
a los datos: las puntuaciones siguen en Atlas.

## ⚖️ Aviso legal

El **bote es una simulación**: el juego no cobra ni paga dinero real. Cualquier sistema
de pago real necesita licencia de juego, KYC, AML y procesadores autorizados. Ver
[RULES.md](RULES.md), sección 5. La temática es satírica y no es información periodística.

## 📄 Licencia

MIT.
