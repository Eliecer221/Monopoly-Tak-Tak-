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
- **Cuentas de usuario reales** con cartera de monedas, gemas y dados.
- **Tienda con pagos reales** (Stripe y MercadoPago): monedas, dados, gemas y pase
  de temporada. El modelo de negocio está en **[MONETIZATION.md](MONETIZATION.md)**.
- **Clasificación global** de mejores partidas, guardada en MongoDB Atlas.
- Interfaz responsive con animaciones, registro de eventos y detalles de cada propiedad.

## 🚀 Cómo jugar

### Con cuentas, tienda y clasificación (recomendado)

El servidor sirve el juego, gestiona las cuentas, cobra en la tienda y guarda las
mejores partidas en MongoDB:

```bash
npm install
MONGODB_URI="mongodb+srv://..." \
STRIPE_SECRET_KEY="sk_test_..." STRIPE_WEBHOOK_SECRET="whsec_..." \
npm start
```

Abre <http://localhost:3000>. Crea tu cuenta, mira la tienda y, al ganar, tu
puntuación se envía sola. Las claves llegan por variables de entorno y **nunca se
guardan en el repositorio** (`.env` está en `.gitignore`; usa `.env.example` como
plantilla).

Sin `MONGODB_URI` el servidor funciona igual: el juego se sirve y las cuentas
quedan desactivadas. Para probar cuentas y tienda en local sin Atlas:

```bash
TAKTAK_MEMORY_DB=1 STRIPE_SECRET_KEY=sk_test_... npm start
```

### Cómo se cobra

1. El jugador crea su cuenta y entra en la tienda.
2. Elige un producto y el servidor crea la orden con **el precio del catálogo**
   (nunca el que manda el navegador) y abre la pasarela de pago.
3. El pago lo confirma el proveedor por **webhook firmado**.
4. Solo entonces se acredita el saldo, y **una sola vez**, aunque el webhook se
   repita.

Los pasos para activar Stripe y MercadoPago están en
**[MONETIZATION.md](MONETIZATION.md)**, sección 4.

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
| `/api/auth/signup` | POST | Crea una cuenta `{email, password, name}` y devuelve una sesión |
| `/api/auth/login` | POST | Inicia sesión `{email, password}` |
| `/api/auth/me` | GET | Devuelve el usuario y su cartera (requiere `Authorization: Bearer`) |
| `/api/auth/logout` | POST | Cierra la sesión |
| `/api/store/catalog` | GET | Catálogo de productos y estado de las pasarelas |
| `/api/store/checkout` | POST | Crea la orden y la sesión de pago `{productId, provider}` |
| `/api/store/orders` | GET | Órdenes del usuario |
| `/api/store/transactions` | GET | Historial de compras del usuario |
| `/api/payments/webhook/stripe` | POST | Webhook de Stripe (firma obligatoria) |
| `/api/payments/webhook/mercadopago` | POST | Webhook de MercadoPago (firma obligatoria) |

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
| Tienda | Compra real de monedas, dados, gemas y pase con Stripe o MercadoPago |
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
node test/integration.mjs   # interfaz + servidor + clasificación + pagos
npm run test:store  # cuentas, tienda y firmas de webhook
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
comprueba que se guarda y se muestra en el modal del ganador. También juega el flujo
completo de la tienda: registro, compra, webhook firmado, acreditación y cartera.

La suite de tienda comprueba que un webhook con firma falsa **no** acredita saldo, que
un webhook repetido **no** duplica monedas, que cada usuario ve solo sus compras y que
sin pasarela configurada el checkout falla en vez de fingir un pago.

## 🗂️ Estructura

```
index.html         Interfaz
css/styles.css     Estilos
js/data.js         Tablero venezolano, fichas, precios y El Magnate
js/cards.js        Cartas de Suerte y Caja Comunal
js/engine.js       Motor de reglas, IA, subastas y tratos
js/ui.js           Render del tablero y modales
js/api.js          Cliente de la API: clasificación, cuentas y tienda
js/account.js      Interfaz de cuenta y tienda con pagos
server/auth.mjs    Cuentas: registro, login y sesiones
server/store.mjs   Catálogo, órdenes y acreditación de compras
server/payments.mjs Stripe y MercadoPago: checkout y firmas
server/db.mjs      Capa de datos: MongoDB o memoria
js/main.js         Configuración y arranque
server/server.mjs  Servidor HTTP y API de clasificación (MongoDB)
test/sim.mjs       Pruebas headless del motor
test/server.mjs    Pruebas del servidor y la API
test/ui.mjs        Pruebas de interfaz con jsdom
test/store.mjs     Pruebas de cuentas, tienda y pagos
test/integration.mjs  Pruebas de integración de extremo a extremo
MONETIZATION.md    Modelo de negocio: catálogo, precios y cómo cobrar
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

La tienda **sí cobra dinero real** por contenido digital (monedas, dados, gemas y pase
de temporada). Eso es comercio electrónico normal, no una apuesta.

El **bote es una simulación**: el juego no cobra ni paga un bote con dinero real. Un
bote real es juego/apuesta y necesita licencia de operador, KYC y AML. Ver
[RULES.md](RULES.md), sección 5 y [MONETIZATION.md](MONETIZATION.md), sección 6.

La temática es satírica y no es información periodística.

## 📄 Licencia

MIT.
