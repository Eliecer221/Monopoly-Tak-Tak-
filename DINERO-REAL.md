# Dinero real: qué está hecho y qué falta

Este documento separa lo que **está implementado y probado** de lo que **no lo
está**. La razón es simple: en un sistema que mueve dinero, confundir lo hecho
con lo pendiente es el fallo más caro.

## Aviso que no es negociable

El HTML que se propuso describe una **ruleta**: el jugador paga una entrada, se
elige un ganador al azar y la casa se queda un porcentaje. El propio texto lo
dice: *"El tablero es una animación del sorteo y no concede ventajas"*. Con
dinero real, eso es **juego de azar con apuesta**. Sin licencia de operador es
delito, y Airtm prohíbe las apuestas en sus términos.

Por eso aquí **no hay bote con apuestas**. Lo que hay es la infraestructura
contable y de cumplimiento que hace falta para mover dinero, que es legítima y
reutilizable para cobrar productos digitales.

---

## 1. Implementado y probado

| Pieza | Archivo | Prueba |
|---|---|---|
| Libro contable de doble partida | `server/schema.sql` | `test/ledger.mjs` |
| Repositorio transaccional | `server/ledger.mjs` | `test/ledger.mjs` |
| Autenticación y límites de dinero | `server/policy.mjs` | `test/payments-infra.mjs` |
| Cliente de Airtm (cerrado) | `server/airtm.mjs` | `test/payments-infra.mjs` |
| Worker del outbox | `server/outbox-worker.mjs` | `test/payments-infra.mjs` |
| Rutas del servidor | `server/server.mjs` | `test/ledger-server.mjs` |
| Esquema y arranque local | `docker-compose.yml` | manual |
| Identificador de cobro del operador | `server/operator.mjs` | `test/operator.mjs` |

Las pruebas corren contra **PostgreSQL 16 real**, no contra dobles.

### Garantías que impone la base de datos, no el código

Estas cuatro no se pueden saltar aunque el código tenga un fallo:

1. **Todo asiento suma cero.** Un trigger diferido (`postings_balanced`) lo
   comprueba al confirmar la transacción. Un asiento descuadrado escrito a mano
   se rechaza. Probado.
2. **Los asientos son inmutables.** Un trigger bloquea `UPDATE` y `DELETE`. Un
   error se corrige con un asiento nuevo, como manda la contabilidad. Probado.
3. **No hay doble gasto.** El saldo se mueve con `SELECT ... FOR UPDATE`. Diez
   reservas de 300 monedas a la vez sobre 704 disponibles: pasan 2 y fallan 8.
   Probado.
4. **Idempotencia.** Cada operación lleva clave única. Repetirla devuelve el
   resultado anterior. Probado con compras y retiros.

### Un bug real que encontraron las pruebas

La primera versión del código **sí tenía doble gasto**: leía el total reservado
*antes* de adquirir el bloqueo, así que diez transacciones simultáneas veían el
mismo saldo disponible y **9 de 10 pasaron** cuando solo 2 tenían fondos.

El arreglo fue invertir el orden: bloquear la fila primero, calcular después. Las
pruebas de concurrencia están precisamente para esto, y por eso no se sustituyen
por dobles.

### Conciliación

`reconcile()` suma todos los asientos de un activo. Si el libro está bien, la suma
es **cero**: cada moneda que la plataforma debe está respaldada por dinero o por
ingreso. Una diferencia se detecta y se guarda. Probado con diferencia forzada.

---

## 2. Lo que NO está implementado

Nada de esta lista se puede resolver escribiendo más código:

| Falta | Por qué no está |
|---|---|
| **Integración de Airtm** | No hay acceso a la documentación oficial del producto contratado. No se inventan endpoints. |
| **Producto Airtm contratado** | Requiere cuenta de comercio aprobada y permiso por escrito para el caso de uso. |
| **Credenciales de producción** | No existen y no deben estar en el repositorio. |
| **Licencia de juego** | Bloqueante si se quisiera un bote con apuestas. Sin ella, es ilegal. |
| **KYC de proveedor certificado** | El KYC del juego es propio; para dinero real hace falta un proveedor homologado. |
| **Auditoría externa** | Un sistema que custodia dinero ajeno debe auditarse. |
| **Persona jurídica y cuenta de comercio** | Requisito legal, no técnico. |

### Las partidas con entrada están construidas pero apagadas

Ver la sección 3-bis. El motor existe, está probado contra PostgreSQL real y
cierra dos agujeros graves (bote inflado desde el cliente y monedas creadas de
la nada). Pero queda apagado por defecto con `REAL_MONEY_ROUNDS=0` hasta que
haya licencia de juego.

### Airtm está cerrado por defecto

`server/airtm.mjs` no tiene ni un endpoint. `ENDPOINTS` está **vacío a
propósito**, y una prueba comprueba que sigue vacío. Cada método lanza
`PROVIDER_NOT_CONFIGURED`.

Esto es deliberado: **fingir un pago exitoso es peor que fallar**. Un sistema que
dice "pagado" sin que el dinero se haya movido es una bomba de relojería.

Cuando se tenga la documentación oficial:

1. Añadir las rutas reales a `ENDPOINTS`.
2. Implementar `createPayout`, `createDeposit` y `getOperation` contra ellas.
3. Verificar los resultados **consultando la operación**, nunca fiándose de un
   mensaje del navegador.
4. Validar la firma de las notificaciones (ya está el verificador con HMAC,
   tiempo constante y caducidad).

---

## 3. Tu 10%: cómo funciona de verdad

Tú quieres recibir el 10%. Aquí está la parte que casi todo el mundo entiende al
revés, y que te ahorra un problema serio.

### El 10% no se transfiere. Se queda.

Mira lo que hace el código:

```js
const winner = Math.round(total * 0.9);
return { total, winner, house: total - winner };
```

El reparto solo decide **cuánto se le paga al ganador**. Lo que no se le paga
**no se mueve**: se queda donde ya estaba, que es tu cuenta.

Es decir: tu 10% no necesita ninguna transferencia. Ya lo tienes. Por eso no
existe —ni debe existir— una función que "pague la comisión al creador". Si
existiera, tendrías que confiar en que no falla, y bastaría un fallo para pagar
dos veces o ninguna.

### Por eso el riesgo no es cobrar de menos: es pagar de más

Como el 10% se queda solo, tu única operación de dinero real es **el retiro del
ganador**. Ahí está todo el riesgo. Y ahí es donde está la defensa:

| Defensa | Dónde |
|---|---|
| Cada retiro lo aprueba una persona | `server/zinli.mjs`, cola de revisión |
| El comprobante se valida por IA, y ante duda va a revisión manual | `server/ai-receipts.mjs` |
| Un comprobante no se reutiliza (hash único) | `server/ai-receipts.mjs` |
| Las monedas se retienen al pedir el retiro y vuelven si se rechaza | `server/zinli.mjs` |
| Idempotencia: repetir la clave no paga dos veces | `server/ledger.mjs` |
| Límites diario, semanal y mensual | `server/policy.mjs` |

Nunca hay un camino en el que el sistema pague sin que una persona lo apruebe.

### Dónde se configura tu dirección

```bash
OPERATOR_PAYOUT_HANDLE="taktak38847eb2"
OPERATOR_PAYOUT_CHANNEL="airtm"
```

Solo el identificador, **no la URL completa**. Si pones `https://airtm.me/...`,
el sistema lo rechaza a propósito: una URL puede llevar parámetros añadidos o
apuntar a otro sitio. Un identificador limpio no.

Ese valor **no es un secreto**: es tu dirección de cobro, como un número de
cuenta. Se muestra al pagador. Lo que nunca debe ir ahí es una contraseña ni un
token.

Puedes comprobar cómo está configurado con `/health`:

```json
{ "operatorPayout": { "channel": "airtm", "configured": true } }
```

Publica **solo la forma**, nunca el valor.

### Un detalle del redondeo

`winner = Math.round(total * 0.9)` y `house = total - winner`. La casa recibe el
resto, así que en un bote de 7 monedas el ganador se lleva 6 y tú 1. Con
`Math.round` a favor del ganador, **tu parte nunca baja del 10%**, y la suma
siempre cuadra. Probado con 10, 100, 999 y 12.345.

## 3-bis. Partidas con entrada real (APAGADAS)

Construí el flujo de partida con entrada de verdad, con la custodia en el libro
contable. Y encontré dos agujeros graves mientras lo hacía. Los dos están
cerrados y probados. Pero la función queda **apagada por defecto**, y quiero ser
explícito sobre por qué.

### Los dos agujeros que tenía el código anterior

**1. El cliente decidía cuánto valía el bote.** La ruta antigua (`/api/pot/settle`)
aceptaba `players` del cuerpo de la petición. Mandar `players: 8` en una partida
de 2 multiplicaba el bote por cuatro. El servidor pagaba ese bote inventado.

**2. El dinero se creaba de la nada.** Peor que el anterior. Los rivales son
**bots locales** (`js/main.js`), así que en el bote solo hay **una cuenta real**:
la del jugador. Pero el reparto pagaba un porcentaje del bote *nominal*:

```
entrada = 100 · jugadores = 3
bote nominal = 300        ← solo entraron 100 de verdad
pago al ganador = 180     ← 80 monedas que nadie puso
```

Ochenta monedas por partida. Y esas monedas se podían retirar. Un bucle
convertía monedas falsas en dinero real.

### Cómo está cerrado ahora

El servidor fija las reglas al **abrir** la partida y las vuelve a comprobar al
**cerrar**. El cliente no elige ni la entrada, ni los jugadores, ni el ganador,
ni el reparto.

La regla de oro es una: **nunca se paga más de lo que se guardó.**

| | Cuánto |
|---|---|
| Lo que se guarda | la entrada del anfitrión |
| Si ganas | recuperas la entrada menos la comisión de la casa |
| Si pierdes | la entrada va entera a la casa |
| Si se cancela | vuelve la entrada entera |

Ganar contra bots **no multiplica** el dinero: devuelve la entrada menos la
comisión. Es honesto, y es lo único que cuadra cuando el rival es un bot.

### Las pruebas que lo demuestran

`test/rounds.mjs`, contra PostgreSQL real:

- Abrir aparta la entrada y anuncia el premio real (60 de 100, no 180 de 300).
- Ganar devuelve la entrada menos la comisión; perder la entrega entera.
- **Cerrar 100 partidas seguidas no crea ni una moneda.** Es la prueba clave:
  si el reparto pagara del bote nominal, el saldo crecería sin límite.
- Inflar los jugadores desde el cliente se rechaza.
- Ganar sin ser el anfitrión se rechaza.
- Cerrar dos veces no paga dos veces.
- El libro sigue cuadrando a cero.

### Por qué está apagado

Esta función **es el bote con apuestas** que me negué a implementar sin licencia.
No puedo cerrar sus agujeros de seguridad y a la vez dejarla encendida. Así que
está construida, probada y **apagada**:

```
REAL_MONEY_ROUNDS="0"   # por defecto
```

Con el flag apagado, las rutas `/api/rounds/*` responden 503 y el juego funciona
igual: se juega sin apostar. Para encenderla hacen falta **dos** cosas: el flag
`REAL_MONEY_ROUNDS=1` y `DATABASE_URL`. Sin licencia de juego, no la enciendas.

## 4. Cómo probarlo

```bash
# 1. Levantar PostgreSQL real
npm run db:up

# 2. Aplicar el esquema
DATABASE_URL=postgres://postgres:devpass@127.0.0.1:55432/taktak npm run db:migrate

# 3. Pruebas del libro (incluye concurrencia)
TAKTAK_TEST_DB=postgres://postgres:devpass@127.0.0.1:55432/taktak npm run test:ledger

# 4. Pruebas de Airtm, política y outbox
npm run test:payments

# 5. Servidor completo contra PostgreSQL
DATABASE_URL=postgres://postgres:devpass@127.0.0.1:55432/taktak npm run test:ledger:server

# 6. Pruebas del cobro del operador
npm run test:operator

# 7. Apagar
npm run db:down
```

## 5. Cómo se enciende el libro en el servidor

El libro contable es **opcional**. Sin `DATABASE_URL` el servidor arranca igual y
las rutas de dinero responden 503.

```bash
DATABASE_URL=postgres://... \
PROJECT_ID=tak-tak \
COIN_SYMBOL=MTC \
ADMIN_TOKEN=un-token-largo-y-aleatorio \
npm start
```

`/health` informa del estado:

```json
{
  "ledger": true,
  "airtm": { "enabled": false, "mode": "airtm-disabled" }
}
```

## 6. Rutas del libro

| Ruta | Método | Quién | Qué hace |
|---|---|---|---|
| `/api/ledger/balance` | GET | usuario con sesión | Saldo según los asientos |
| `/api/ledger/withdraw` | POST | usuario con KYC, correo y 2FA | Reserva y crea el retiro |
| `/api/ledger/reconcile` | POST | administrador | Comprueba que el libro cuadra |

Un retiro sin KYC verificado, correo verificado y 2FA activo responde **403**. La
política se evalúa **antes** que el saldo: no importa cuánto tengas si no cumples
los requisitos.

## 7. Límites de retiro

| Ventana | Límite |
|---|---|
| Diario | 20.000 monedas |
| Semanal | 80.000 monedas |
| Mensual | 250.000 monedas |

Distintos de los límites de compra, y más estrictos.

---

## Resumen honesto

**Hecho y probado:** el motor contable, la concurrencia sin doble gasto, la
idempotencia, las reservas, el outbox con reintentos, la conciliación, los límites
y la verificación de firmas. Contra PostgreSQL real.

**No hecho:** todo lo que depende de Airtm, de una licencia o de una persona
jurídica. No es cuestión de más código.

**Y lo que no voy a construir:** un bote con apuestas sin licencia. El propio
módulo que se me entregó lo dice bien: *"Los datos que faltan no se solucionan
pegando una clave"*.
