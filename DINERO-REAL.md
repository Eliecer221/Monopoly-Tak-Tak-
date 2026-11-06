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

## 3. Cómo probarlo

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

# 6. Apagar
npm run db:down
```

## 4. Cómo se enciende el libro en el servidor

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

## 5. Rutas del libro

| Ruta | Método | Quién | Qué hace |
|---|---|---|---|
| `/api/ledger/balance` | GET | usuario con sesión | Saldo según los asientos |
| `/api/ledger/withdraw` | POST | usuario con KYC, correo y 2FA | Reserva y crea el retiro |
| `/api/ledger/reconcile` | POST | administrador | Comprueba que el libro cuadra |

Un retiro sin KYC verificado, correo verificado y 2FA activo responde **403**. La
política se evalúa **antes** que el saldo: no importa cuánto tengas si no cumples
los requisitos.

## 6. Límites de retiro

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
