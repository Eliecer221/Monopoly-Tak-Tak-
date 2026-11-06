# Tablero de Monopoly Tak Tak

Imagen limpia del tablero, aislada sobre fondo gris claro, sin interfaz ni
paisaje. Formato 1:1.

## Archivos

| Archivo | Qué es |
|---|---|
| `monopoly-tak-tak-board.png` | Imagen final, 2048×2048 px |
| `monopoly-tak-tak-board.svg` | Fuente vectorial del tablero |
| `generate-board.mjs` | Genera el SVG a partir de los datos del juego |
| `render-board.sh` | Regenera SVG y PNG |

## Regenerar

```bash
./board/render-board.sh      # 2048×2048 (por defecto)
./board/render-board.sh 3    # 3072×3072
./board/render-board.sh 1    # 1024×1024
```

## Cómo está hecho

No es una edición de una captura: es una reconstrucción. El tablero se dibuja en
el plano de juego `(u,v)` de `[0,1]²` y se proyecta en isométrico a un rombo, con
la esquina `(0,0)` arriba, `(1,0)` a la derecha, `(1,1)` abajo (la salida) y
`(0,1)` a la izquierda.

La geometría sale de los datos reales del juego (`js/data.js`): las 40 casillas,
los 8 grupos de color con sus valores hex, las 4 crisis y las 4 estaciones. Las
casas y los hoteles se colocan sobre las propiedades y se ordenan por profundidad
para que se dibujen en el orden correcto.

Cada pieza 3D (casillas, casas, cofres, cajas) es una caja en el plano del
tablero con tres caras visibles y sombra de contacto, para dar volumen sin salir
del lenguaje visual de juego móvil.

## Elementos incluidos

- Recorrido exterior de 40 casillas, de tonos crema y verde menta, con las
  franjas de color de cada propiedad.
- Símbolos de interrogación azules (Suerte), cofres dorados (Caja Comunal),
  trenes (estaciones), triángulos de crisis y la flecha roja junto a «GO».
- Casas y edificios rojos y verdes sobre las propiedades.
- Zona central de madera con tablones, vigas y abertura octagonal.
- Dos cofres azules con refuerzos dorados abajo, mueble azul claro arriba y
  cajas pequeñas sobre las plataformas.
- Fondo gris muy claro y sombra suave bajo el tablero.

## Elementos excluidos

Interfaz de la aplicación, paisaje exterior, avatares, notificaciones y
cualquier marcador superpuesto.
