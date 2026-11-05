# 🎩 Monopoly TAK TAK

Clon del clásico juego de mesa para el navegador, con temática **TAK TAK**.
Sin dependencias, sin instalación y sin conexión: abre `index.html` y juega.

![estado](https://img.shields.io/badge/estado-jugable-35d07f)

## ✨ Características

- **Tablero completo de 40 casillas** con las 8 familias de colores, 4 estaciones y 2 compañías.
- **2 a 4 jugadores** en el mismo dispositivo: cada uno puede ser humano o IA.
- **IA** que compra, construye, hipoteca, puja en subastas y **propone tratos** para completar monopolios.
- **Reglas clásicas**: alquileres escalados, grupos de color, construcción equilibrada, hoteles,
  hipotecas con interés, cárcel, dobles, impuestos, Suerte y Arca Común.
- **Subastas** cuando un jugador rechaza comprar.
- **Tratos** entre jugadores: intercambio de propiedades y efectivo con previsualización.
- **Guardado local** de la partida en el navegador.
- Interfaz responsive con animaciones, registro de eventos y detalles de cada propiedad.

## 🚀 Cómo jugar

Necesitas servir los archivos por HTTP (los módulos ES no funcionan con `file://`):

```bash
# opción 1: Python
python3 -m http.server 8000

# opción 2: Node
npx serve .
```

Luego abre <http://localhost:8000> en el navegador.

También puedes publicarlo como sitio estático en GitHub Pages sin cambios.

## 🎮 Reglas implementadas

| Elemento | Comportamiento |
| --- | --- |
| Salida | Cobras $200 al pasar |
| Propiedades | Se compran al caer; si rechazas, van a subasta |
| Grupo de color | Alquiler base ×2 sin casas; permite construir |
| Construcción | Equilibrada: no puedes sacar más de 1 casa de ventaja |
| Estaciones | Alquiler $25 / $50 / $100 / $200 según cuántas poseas |
| Compañías | Alquiler 4× dados (10× con ambas) |
| Hipoteca | Recibes la mitad del precio; recuperar cuesta +10% |
| Cárcel | Pagas $50, usas carta o sacas dobles; tras 3 turnos pagas |
| Dobles | Repites turno; tres dobles seguidos te llevan a la cárcel |
| Bancarrota | Si no puedes pagar ni hipotecando, tus bienes pasan al acreedor |

## 🧪 Pruebas

El motor es agnóstico de la interfaz y se prueba de forma headless:

```bash
npm test
```

La suite juega 60 partidas completas con IA (verificando invariantes: dinero no negativo,
propiedades sin duplicados, construcciones equilibradas), ejercita los caminos de decisión
humanos (tiradas, compras, subastas, cárcel, recaudación y tratos) y valida alquileres,
hipotecas y bancarrota.

## 🗂️ Estructura

```
index.html        Interfaz
css/styles.css    Estilos
js/data.js        Tablero, grupos, precios y alquileres
js/cards.js       Cartas de Suerte y Arca Común
js/engine.js      Motor de reglas, IA, subastas y tratos
js/ui.js          Render del tablero y modales
js/main.js        Configuración y arranque
test/sim.mjs      Pruebas headless del motor
```

## 📄 Licencia

MIT.
