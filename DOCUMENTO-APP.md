# Monopoly Tak Tak — Documento de producto y sistema

Este documento describe la aplicación completa: el juego, la plataforma de
cuentas, el sistema de monedas, el pago manual por Zinli con validación por IA y
los retiros. Es la base conceptual y técnica para operar la aplicación.

> ⚠️ **Advertencia legal obligatoria.** Este sistema **solo es legal si se opera
> con licencia oficial de juego**, cumplimiento de **KYC** y **AML**, y bajo las
> leyes del país correspondiente. **Sin licencia es ilegal.** Un bote donde el
> jugador paga para entrar y el ganador cobra dinero real es **juego/apuesta con
> dinero real**; en Venezuela lo regula la Comisión Nacional de Casinos y
> operarlo sin licencia es delito. Además, las pasarelas de pago cierran la
> cuenta al detectar apuestas sin licencia. Lee la sección 7 antes de facturar.

---

## 1. Visión general

**Monopoly Tak Tak** es una versión satírica del Monopoly ambientada en
Venezuela, con un sistema de monedas estilo TikTok: se compran con dinero real,
se usan para entrar a las partidas y el ganador puede canjearlas.

| Pieza | Estado en este repositorio |
|---|---|
| Juego (tablero, cartas, IA, 2–8 jugadores) | Implementado y probado |
| Cuentas de usuario con correo y contraseña | Implementado y probado |
| Verificación de correo y teléfono | Implementado y probado |
| 2FA (TOTP) | Implementado y probado |
| KYC (documento + selfie) | Implementado, con decisión del administrador |
| Límites de compra y juego responsable | Implementado y probado |
| Compra de monedas por Zinli con validación por IA | Implementado y probado |
| Retiro de monedas por Zinli | Implementado y probado |
| Reparto del bote 60/40 | Implementado y probado |
| Licencia de juego y cumplimiento legal | **Pendiente (no es código)** |

---

## 2. Flujo completo de registro y KYC

```
Registro (correo + contraseña + nombre)
        │
        ▼
Sesión iniciada (token de 30 días)
        │
        ├──► Verificación de correo  (código de 6 dígitos, 15 min)
        │
        ├──► Verificación de teléfono (código de 6 dígitos, 15 min)
        │
        ├──► 2FA opcional pero recomendado (TOTP + 8 códigos de respaldo)
        │
        ▼
KYC obligatorio  ← sin esto NO se compra ni se retira
        │
        ├── Foto del documento (cédula, pasaporte o licencia)
        ├── Selfie
        ├── Número de documento
        └── Consentimiento explícito
        │
        ▼
Estado: pending  ──►  El administrador decide
        │
        ├── verified  ──►  Compra y retiro habilitados (límites ampliados)
        └── rejected  ──►  No se compra ni se retira
```

**Reglas que aplica el código** (`server/kyc.mjs`):

| Regla | Comportamiento |
|---|---|
| Sin KYC | La compra responde 403 con el mensaje del KYC |
| KYC pendiente | La compra sigue bloqueada |
| KYC rechazado | Bloqueado; se puede reintentar |
| Documento ilegible | Se rechaza en el momento (imagen < 2 KB o tipo inválido) |
| Sin consentimiento | Se rechaza |
| Quién aprueba | Solo el administrador, con `x-admin-token` |

El usuario nuevo arranca con **500 monedas de bienvenida** para poder probar el
juego sin comprar. Las monedas de bienvenida no son retirables hasta completar el
KYC y la verificación.

**Límites por defecto** (`server/kyc.mjs`):

| Nivel | Diario | Semanal | Mensual |
|---|---|---|---|
| Sin KYC (no puede comprar) | — | — | — |
| KYC verificado | $200 | $800 | $2.500 |

---

## 3. Flujo de compra de monedas: Zinli + comprobante + IA

```
1. El usuario elige un paquete
        │
        ▼
2. La app muestra los datos de Zinli del dueño de la plataforma
   (correo, teléfono y titular)
        │
        ▼
3. El usuario paga desde SU PROPIA cuenta de Zinli
        │
        ▼
4. Sube el comprobante (captura) + la referencia de la transacción
        │
        ▼
5. Validación automática por IA
        │
        ├── approved       ──►  Se acreditan las monedas al instante
        ├── manual_review  ──►  Cola del administrador
        └── rejected       ──►  No se acredita y se notifica
```

**Datos de Zinli** que se muestran (`server/zinli.mjs`): correo del receptor,
teléfono del receptor y titular. Se configuran por entorno
(`ZINLI_RECEIVER_EMAIL`, `ZINLI_RECEIVER_PHONE`, `ZINLI_RECEIVER_NAME`). **Nunca**
se escriben en el repositorio.

**Paquetes disponibles** (`server/store.mjs`):

| Producto | Precio | Entrega |
|---|---|---|
| `coins_500` | $1,99 | 500 monedas |
| `coins_1500` | $4,99 | 1.500 monedas |
| `coins_4000` | $9,99 | 4.000 monedas |
| `coins_10000` | $19,99 | 10.000 monedas |
| `dice_20` | $2,99 | 20 dados |
| `gems_100` | $4,99 | 100 gemas |
| `season_pass` | $9,99 | Pase de temporada |

El paquete grande rinde más por dólar a propósito: es el que más margen deja.

**Garantías del flujo, cubiertas por pruebas:**

| Garantía | Cómo se cumple |
|---|---|
| El monto sale del catálogo | El cliente solo manda `productId`; el precio lo pone el servidor |
| Un comprobante no se reutiliza | Se guarda el hash SHA-256 de la imagen y se rechaza el repetido |
| Un comprobante falso no acredita | El monto debe cubrir la orden y el destinatario debe coincidir |
| Una imagen manipulada no acredita | La señal `looksEdited` baja la puntuación y bloquea la aprobación |
| Los límites se respetan | Se comprueba el gasto diario, semanal y mensual antes de crear la orden |
| Una cuenta autoexcluida no compra | La autoexclusión bloquea la compra de inmediato |

---

## 4. Cómo funciona una partida de 2 a 8 jugadores usando monedas

```
1. El jugador entra con su cuenta y compra monedas.
        │
        ▼
2. Configura la partida: 2 a 8 jugadores, dinero inicial y buy-in en monedas.
        │
        ▼
3. Cada jugador aporta el buy-in al bote. Las recargas se pueden hacer
   durante la partida.
        │
        ▼
4. Se juega con las reglas del tablero venezolano (sección 8).
        │
        ▼
5. Gana quien deja en bancarrota a los demás.
        │
        ▼
6. Se liquida el bote: 60% al ganador, 40% a la casa.
        │
        ▼
7. El ganador puede retirar sus monedas por Zinli.
```

**Fichas (8):** Turpial 🐦, Jaguar 🐆, Chigüire 🦫, Tonina 🐬, Oso Frontino 🐻,
Caimán del Orinoco 🐊, Guacamaya 🦜 y Mono Araguato 🐒.

**Parámetros:** de 2 a 8 jugadores (`MIN_PLAYERS`/`MAX_PLAYERS` en `engine.js`),
dinero inicial de $1.000 a $2.500, buy-in de 0 a 100.000 monedas. Cada jugador
puede ser humano o IA.

**Ejemplo con 8 jugadores y buy-in de 100 monedas:**

| Concepto | Monedas |
|---|---|
| Aporte por jugador | 100 |
| Bote total (8 × 100) | 800 |
| Ganador (60%) | 480 |
| Casa (40%) | 320 |

El motor de la partida es independiente de la interfaz: no toca el DOM y se puede
simular por completo, que es como se prueba (60 partidas completas en cada
ejecución de la suite).

---

## 5. Sistema de reparto 60/40

```
function splitPot(pot):
    winner = round(pot × 0.60)
    house  = pot − winner      ← se resta, no se recalcula
    return { winner, house }
```

El 40% se calcula **por resta**, no multiplicando: así la suma de las dos partes
es siempre exactamente el bote y no se pierden monedas en el redondeo. La suite
lo comprueba con 1, 3, 9, 33, 999 y 12.345 monedas.

| Bote | Ganador (60%) | Casa (40%) |
|---|---|---|
| 100 | 60 | 40 |
| 800 | 480 | 320 |
| 7 | 4 | 3 |
| 999 | 599 | 400 |

Reglas de la liquidación:

- Solo el **ganador** puede liquidar el bote.
- La partida debe tener entre **2 y 8** jugadores.
- El ganador debe tener monedas para su buy-in.
- Queda registrado en el historial con el desglose completo.

---

## 6. Flujo de retiro por Zinli

```
1. El usuario solicita el retiro (mínimo 1.000 monedas).
        │
        ▼
2. El servidor comprueba: KYC verificado + correo verificado + saldo suficiente.
        │
        ▼
3. Las monedas se RETIENEN de inmediato (no se pueden gastar dos veces).
        │
        ▼
4. El dueño envía el dinero por Zinli al correo VERIFICADO del usuario.
        │
        ▼
5. El administrador confirma el pago (o lo rechaza).
        │
        ├── paid      ──►  Queda en el historial
        └── rejected  ──►  Las monedas vuelven al usuario
```

**Reglas de seguridad:**

| Regla | Por qué |
|---|---|
| El destino es el **correo verificado** de la cuenta | Evita que una cuenta robada desvíe el dinero a otro correo |
| Las monedas se retienen al solicitar | Evita gastarlas mientras el retiro está en curso |
| Un rechazo devuelve las monedas | No se pierde saldo por un retiro fallido |
| Comisión del 5%, mostrada antes de confirmar | Transparencia con el usuario |
| Mínimo de 1.000 monedas | Evita retiros de céntimos que cuestan más que el envío |

---

## 7. Arquitectura de alto nivel de la IA que valida los pagos

La validación tiene **dos capas**: un motor de reglas determinista y un proveedor
de visión opcional. La IA **nunca** acredita por sí sola cuando hay dudas.

```
                    ┌──────────────────────────────────────┐
   Comprobante ───► │  1. Huella SHA-256 de la imagen      │
                    └──────────────┬───────────────────────┘
                                   │ ¿ya usada?
                          sí ┌─────┴─────┐ no
                             ▼           ▼
                        RECHAZO   ┌──────────────────────────┐
                        inmediato │ 2. Proveedor de visión   │
                                  │  OpenAI / Gemini / Claude│
                                  └──────────────┬───────────┘
                                                 │
                                                 ▼
                                  ┌──────────────────────────┐
                                  │ 3. Motor de reglas       │
                                  │  (puntuación 0 a 1)      │
                                  └──────────────┬───────────┘
                                                 │
                          ┌──────────────────────┼──────────────────────┐
                          ▼                      ▼                      ▼
                     score ≥ 0.85         0.35 – 0.85             score ≤ 0.35
                     sin manipulación                             o manipulación
                          │                      │                      │
                          ▼                      ▼                      ▼
                      APPROVED           MANUAL_REVIEW           REJECTED
                    (acredita)          (cola del admin)        (no acredita)
```

**Cómo puntúa el motor de reglas** (`server/ai-receipts.mjs`):

| Señal | Peso | Por qué |
|---|---|---|
| El monto cubre la orden | +0,40 | Es la comprobación principal |
| Moneda correcta | +0,15 | Evita pagos en otra divisa |
| El destinatario coincide con el Zinli de la plataforma | +0,25 | Evita pagar a un tercero |
| La imagen no parece editada | +0,10 | Señal de autenticidad |
| Confianza del modelo | +0,10 | Ajuste fino |
| **Monto insuficiente** | **−0,30** | No cubre la compra |
| **El destinatario no coincide** | **−0,20** | Pago a otra cuenta |
| **Señales de manipulación** | **−0,50** | Fraude evidente |

**Señales adicionales que fuerzan revisión manual**, aunque el score sea alto:

- El usuario subió **5 o más comprobantes** en las últimas 24 horas.
- La **referencia declarada** no coincide con la del comprobante.
- No se pudo leer el monto.

**Proveedores soportados:** OpenAI (`gpt-4o-mini`), Google Gemini
(`gemini-1.5-flash`) y Anthropic (`claude-3-5-haiku`). Se elige por variable de
entorno y el resto del sistema no cambia: la salida se normaliza a una forma
común (`amount`, `currency`, `sender`, `receiver`, `reference`, `date`,
`looksEdited`, `confidence`).

**Sin proveedor de IA configurado**, todo comprobante va a **revisión manual**.
El sistema nunca finge una aprobación.

**Qué queda registrado por cada comprobante:** orden, usuario, hash de la imagen,
veredicto, puntuación, motivos y proveedor. Todo queda auditable.

---

## 8. Medidas de seguridad y anti-fraude

### 8.1 Dinero y pagos

| Medida | Implementación |
|---|---|
| El precio lo pone el servidor | El cliente solo manda `productId` |
| Comprobante no reutilizable | Hash SHA-256 único por imagen |
| Sin aprobación no hay saldo | La acreditación es posterior al veredicto |
| Acreditación una sola vez | La orden pasa a `paid` y no se repite |
| Destinatario verificado | El receptor debe coincidir con el Zinli de la plataforma |
| Detección de manipulación | Señal `looksEdited` del modelo |
| Límites de gasto | Diario, semanal y mensual |
| Abuso de comprobantes | 5 intentos al día fuerzan revisión manual |

### 8.2 Cuentas

| Medida | Implementación |
|---|---|
| Contraseñas | scrypt con sal por usuario, comparación en tiempo constante |
| Sesiones | Token de 32 bytes, caducidad de 30 días, revocable |
| 2FA | TOTP (RFC 6238) compatible con Google Authenticator |
| Códigos de respaldo | 8 códigos de un solo uso |
| Desactivar 2FA | Exige un código válido (una sesión robada no puede quitarlo) |
| Verificación de correo y teléfono | Códigos de 6 dígitos con caducidad de 15 minutos |
| Fuga de datos | El hash, la sal y el secreto de 2FA no salen en ninguna respuesta |
| Enumeración de cuentas | Mismo mensaje para correo inexistente y contraseña mala |

### 8.3 Infraestructura

| Medida | Implementación |
|---|---|
| Rutas de administración | Protegidas por `ADMIN_TOKEN` |
| Límite de peticiones | 10 por minuto por IP (20 en registro y login) |
| Tamaño de petición | Máximo 16 KB |
| Archivos ocultos | `.env` y `.git` nunca se sirven |
| Escape de rutas | Bloqueado (`../`) |
| Secretos | Solo por variables de entorno; `render.yaml` con `sync: false` |
| Base de datos | Índices únicos en correo, sesión, orden y clave de idempotencia |

### 8.4 Juego responsable

| Herramienta | Comportamiento |
|---|---|
| Autoexclusión | De 1 a 365 días; bloquea las compras al instante |
| Límites de compra | Diario, semanal y mensual, ampliados al verificar el KYC |
| Reality checks | Aviso del tiempo y el gasto en la sesión |
| Historial completo | Compras, partidas y retiros a la vista del usuario |

---

## 9. Casillas, propiedades y cartas

### 9.1 Tablero (40 casillas)

Recorrido antihorario desde SALIDA:

```
 0 SALIDA                    20 ESTACIONAMIENTO DE EMBAJADAS
 1 Bodegón de Barrio         21 SIDOR
 2 Caja Comunal              22 Suerte
 3 Abastos La Esquina        23 Alcasa
 4 CRISIS: Se va la luz      24 Ferrominera Orinoco
 5 Metro de Caracas          25 Puerto de La Guaira
 6 Lácteos Los Andes         26 Cementos Progreso
 7 Suerte                    27 Cemento Andino
 8 Agroisleña                28 CRISIS: Marcadores cambiarios
 9 Mercal                    29 Vencemos Cemento
10 CÁRCEL DE HELICOIDES      30 IR A LA CÁRCEL
11 Hidroven                  31 Ministerio de Finanzas
12 CRISIS: Se va el agua     32 Ministerio de Energía
13 Hidrocapital              33 Caja Comunal
14 IVSS                      34 Ministerio de Petróleo
15 Ferrocarril E. Zamora     35 Aeropuerto de Maiquetía
16 Corpoelec                 36 Suerte
17 Caja Comunal              37 PDVSA
18 Electricidad de Caracas   38 CRISIS: Deuda con trabajadores
19 Cantv                     39 Paseo PDVSA Marina
```

### 9.2 Grupos de color

| Grupo | Propiedades |
|---|---|
| Marrón | Bodegón de Barrio · Abastos La Esquina |
| Celeste | Lácteos Los Andes · Agroisleña · Mercal |
| Rosa | Hidroven · Hidrocapital · IVSS |
| Naranja | Corpoelec · Electricidad de Caracas · Cantv |
| Rojo | SIDOR · Alcasa · Ferrominera Orinoco |
| Amarillo | Cementos Progreso · Cemento Andino · Vencemos Cemento |
| Verde | Ministerio de Finanzas · Ministerio de Energía · Ministerio de Petróleo |
| Azul | PDVSA · Paseo PDVSA Marina |
| Transportes | Metro de Caracas · Ferrocarril Ezequiel Zamora · Puerto de La Guaira · Aeropuerto de Maiquetía |

### 9.3 Las 4 casillas de crisis

| Casilla | Qué pasa | Costo |
|---|---|---|
| Se va la luz | Apagón nacional: plantas y velas | Desde $100, sube 25% cada 40 turnos |
| Se va el agua | Semanas sin agua: camiones cisterna | Igual |
| Marcadores cambiarios | El dólar BCV no alcanza, se paga al paralelo | Igual |
| Deuda con trabajadores | Retroactivos atrasados | Igual |

### 9.4 Ejemplos de cartas de Suerte

| Carta | Efecto |
|---|---|
| **¡Sale Maduro!** Se despeja el camino | Avanzas hasta PDVSA |
| **Operación del 3 de enero** | Vas a la cárcel sin avisar |
| **Delcy Rodríguez asume como presidenta interina** | Cobras $200 de "gestión" |
| **María Corina Machado vuelve al país** | Cada rival te paga $50 |
| **Henrique Capriles te presta $75** | Recibes $75 |
| **Acuerdo petrolero con Estados Unidos** | Recibes $300 de inversión |
| **El Magnate Trumpista ofrece un "deal perfecto"** | Pagas $100 en asesores |
| **Apagón de 12 horas** | Pagas $80 |
| **Dólar BCV vs paralelo** | La brecha te cuesta $60 |
| **Llegó la remesa** | Recibes $150 |
| **Devaluación sorpresa** | Pierdes $120 |
| **Carta de salida libre de la cárcel** | La guardas |

### 9.5 Ejemplos de cartas de Caja Comunal

| Carta | Efecto |
|---|---|
| **El CLAP llega tarde pero llega** | Recibes $100 |
| **Se va el agua otra vez** | Pagas $70 |
| **Colectivo de vecinos te ayuda** | Cada rival te aporta $40 |
| **Bonos de la patria** | Recibes $150 |
| **Deuda pública con trabajadores** | Pagas $150 |
| **Remesas récord** | Recibes $200 |
| **Mercado paralelo de divisas** | Pierdes $80 |
| **Inversión extranjera en tu zona** | Recibes $250 |
| **Redada y revisión** | Vas a la cárcel sin cobrar salida |
| **Corte de luz en el hospital** | Pagas $110 |

### 9.6 El Magnate Trumpista 🕶️

Aparece cada **12 turnos** con un "deal". Aceptar o rechazar tiene consecuencias
reales (dinero o perder un turno). Ejemplos de ofertas:

| Oferta | Efecto |
|---|---|
| Licencia petrolera por $200 y una disculpa pública | Pagas $200 |
| Levantar sanciones por $150 | Pagas $150 |
| "Invierto en tu empresa": $300 y se lleva el crédito | Recibes $300 |
| Deal del cemento: compra tu grupo de construcción | Recibes $500 |
| Redada migratoria | Pagas $100 en abogados o pierdes un turno |

---

## 10. Reglas del juego

| Elemento | Comportamiento |
|---|---|
| Salida | Cobras $200 al pasar |
| Propiedades | Se compran al caer; si rechazas, van a subasta |
| Grupo de color | Alquiler base ×2 sin casas; permite construir |
| Construcción | Equilibrada: máximo 1 casa de ventaja |
| Transportes | Alquiler $25 / $50 / $100 / $200 según cuántos poseas |
| Crisis | Te cobran al caer; el costo sube con el tiempo |
| El Magnate | Cada 12 turnos, un deal que aceptar o rechazar |
| Hipoteca | Recibes la mitad; recuperar cuesta +10% |
| Cárcel | Pagas $50, usas carta o sacas dobles; tras 3 turnos pagas |
| Dobles | Repites turno; tres dobles seguidos te llevan a la cárcel |
| Bancarrota | Sin poder pagar ni hipotecando, tus bienes pasan al acreedor |
| Bote | 60% ganador, 40% casa |

---

## 11. API de la plataforma

| Ruta | Método | Qué hace |
|---|---|---|
| `/api/auth/signup` | POST | Crea la cuenta y la sesión |
| `/api/auth/login` | POST | Inicia sesión |
| `/api/auth/me` | GET | Usuario, cartera, KYC y 2FA |
| `/api/auth/verify/start` | POST | Envía el código de correo o teléfono |
| `/api/auth/verify/confirm` | POST | Confirma el código |
| `/api/auth/2fa/setup` | POST | Genera el secreto TOTP |
| `/api/auth/2fa/enable` | POST | Activa el 2FA con un código |
| `/api/auth/2fa/disable` | POST | Desactiva el 2FA con un código |
| `/api/kyc/submit` | POST | Envía documento, selfie y consentimiento |
| `/api/kyc/status` | GET | Estado del KYC y límites |
| `/api/kyc/decide` | POST | Aprueba o rechaza (administrador) |
| `/api/responsible/self-exclude` | POST | Autoexclusión |
| `/api/zinli/quote` | GET | Datos de Zinli de la plataforma |
| `/api/zinli/order` | POST | Crea la orden de compra |
| `/api/zinli/receipt` | POST | Sube el comprobante y lo valida la IA |
| `/api/zinli/withdrawal` | POST | Solicita el retiro |
| `/api/zinli/withdrawals` | GET | Historial de retiros |
| `/api/pot/settle` | POST | Liquida el bote 60/40 |
| `/api/admin/receipts` | GET | Cola de revisión (administrador) |
| `/api/admin/receipts/decide` | POST | Aprueba o rechaza un comprobante |
| `/api/admin/withdrawals/decide` | POST | Confirma o rechaza un retiro |
| `/api/store/catalog` | GET | Catálogo de productos |
| `/api/health` | GET | Estado del sistema |

---

## 12. Requisitos legales y operativos

**El código ya funciona. Esto es lo que falta del lado legal y del negocio:**

| Pendiente | Por qué |
|---|---|
| **Licencia de juego** | **Bloqueante.** Sin licencia, el bote con dinero real es ilegal. En Venezuela: Comisión Nacional de Casinos. |
| **KYC real** | Aquí la decisión es del administrador; en producción, un proveedor certificado |
| **AML** | Prevención de lavado: origen de fondos y reportes de operaciones sospechosas |
| **Entidad legal y cuenta de comercio** | Zinli y las pasarelas exigen un comercio verificado |
| **Registro fiscal y facturación** | Los ingresos se declaran; aplica el IVA |
| **Términos y condiciones** | Obligatorios para cobrar; describen la moneda virtual y los reembolsos |
| **Política de privacidad** | Obligatoria al tratar datos personales y documentos de identidad |
| **Restricción de edad** | Contenido satírico y compras: mayoría de edad |
| **Geolocalización** | Bloquear jurisdicciones donde el juego está prohibido |
| **Reembolsos** | Política clara y cumplida |
| **Proveedores externos** | Envío de correo y SMS, y servicio de KYC |
| **Auditoría** | Revisiones periódicas del sistema de pagos |

**Ninguna de estas líneas es código.** Ninguna cantidad de programación convierte
en legal un bote sin licencia. Antes de cobrar el primer dólar, consulta a un
abogado y a un contador.

---

## 13. Cómo probar el sistema

```bash
npm install

# Todo el sistema, con datos en memoria (sin Atlas)
TAKTAK_MEMORY_DB=1 TAKTAK_DEV_CODES=1 ADMIN_TOKEN=admin \
ZINLI_RECEIVER_EMAIL="pagos@tudominio.com" \
OPENAI_API_KEY="sk-..." \
npm start

# Suites de prueba
npm run test:sim        # motor: 60 partidas completas
npm run test:server     # servidor y clasificación
npm run test:ui         # interfaz (jsdom)
npm run test:store      # cuentas, tienda y firmas de webhook
npm run test:platform   # 2FA, KYC, IA de comprobantes, retiros y bote
node test/integration.mjs  # extremo a extremo
```

`TAKTAK_DEV_CODES=1` devuelve los códigos de verificación en la respuesta para
poder probar. **Nunca** debe activarse en producción.

---

## 14. Resumen

Monopoly Tak Tak es un juego completo (tablero venezolano, 2–8 jugadores, IA,
cartas satíricas) montado sobre una plataforma de monedas: cuentas reales,
verificación, 2FA, KYC, compra manual por Zinli validada por IA, retiro al correo
verificado y reparto del bote 60/40.

**Todo el código funciona y está probado.** Lo que decide si el negocio es legal
es la licencia de juego y el cumplimiento de KYC y AML, no la calidad del
software. **Sin licencia, operar el bote con dinero real es ilegal.**
