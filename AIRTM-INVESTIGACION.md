# ¿Hay juegos que cobren y paguen con Airtm?

Investigación hecha el 2026-11-06 consultando las fuentes oficiales de Airtm.
Respuesta corta: **no, no existe ningún videojuego integrado con Airtm.** Lo que
hay son plataformas de dinero y de tareas, no juegos. Y Airtm prohíbe
explícitamente el juego ilegal.

## 1. Lo que sí encontré: plataformas, no juegos

En la base de conocimiento de Airtm hay integraciones documentadas. Ninguna es un
videojuego:

| Plataforma | Qué es | Dirección |
|---|---|---|
| **Deriv** | Opciones binarias y forex | Depósito **y** retiro con Airtm |
| **iForex** | Forex | Depósito |
| **Timebucks** | Encuestas y tareas por recompensa | Retiro |
| **Remotasks** | Microtareas | Retiro |
| **Deel** | Nómina | Retiro |
| **Upwork** | Trabajo freelance | Retiro |
| **Airbnb** | Alquileres | Retiro |

Fuentes:
- https://help.airtm.com/en/support/solutions/articles/47001229350-how-to-add-money-to-your-deriv-account-using-airtm
- https://help.airtm.com/en/support/solutions/articles/47001249479-how-to-withdraw-funds-from-deriv-to-your-bank-account
- https://help.airtm.com/en/support/solutions/articles/47001230089-how-to-withdraw-from-timebucks-to-your-bank-account

Busqué también por "roblox", "freefire", "videojuego" y "lottery" en la base de
conocimiento: **cero resultados**. Deriv es lo más parecido a "juego con dinero",
y no es un juego: es un bróker regulado.

### Un dato útil: Venezuela NO está restringida

Airtm presta servicio en todas las regiones **excepto** una lista de países
sancionados (Cuba, Irán, Corea del Norte, Rusia, Bielorrusia, Crimea...).
Venezuela **no aparece** en esa lista.

Fuente: https://help.airtm.com/en/support/solutions/articles/47001229360-about-api-documentation-and-scope-of-integration

## 2. Lo que Airtm dice sobre el juego

De los Términos de Servicio (última actualización: 16 de junio de 2026):

> "In accordance with the requirements of the **Unlawful Internet Gambling
> Enforcement Act of 2006 and Regulation GG**, this notification is to inform you
> that **restricted transactions are prohibited** from being processed through
> your account or relationship with Airtm. [...] you certify that you do not
> engage in unlawful Internet gambling [...] If you do not, **we may terminate
> your access to various payment methods or close your account**."

> "The use of our direct add and direct withdraw Services **for ARS in connection
> with betting or gambling transactions shall be prohibited**."

> "Prohibited Activities [...] any activity (1) which would **violate, or assist
> in violation of, any law**, statute, ordinance, or regulation [...] or which
> would involve proceeds of any unlawful activity."

> "We may suspend or terminate your [...] Account [...] if [...] We suspect you of
> using your Account in connection with any **Prohibited Activity**."

Fuente: https://www.airtm.com/en/terms-and-conditions/

### Lectura precisa, sin exagerar

Aquí conviene ser exacto, porque es fácil exagerar en las dos direcciones:

- **Airtm no prohíbe todo el juego.** Lo que prohíbe es el juego **ilegal**
  ("unlawful Internet gambling") y, específicamente, las apuestas ligadas al peso
  argentino (ARS).
- **Pero sí prohíbe lo que tú planteabas.** Un sorteo con apuesta y sin licencia
  es juego ilegal. Cae de lleno en la cláusula. Y la consecuencia está escrita:
  cierre de cuenta y bloqueo de métodos de pago.
- **Y la ley te obliga igual, aunque Airtm callara.** La UIGEA y la Regulación GG
  son normas de EE. UU. que Airtm aplica a sus cuentas. Que Airtm prohíba el
  juego ilegal no es un capricho suyo: es su obligación legal.

Traducido: el problema no es que Airtm "no te deje". Es que **sin licencia, la
actividad es ilegal**, y entonces Airtm está obligada a cerrarte la cuenta. Si
tuvieras licencia de operador, esa cláusula concreta no te aplicaría.

## 3. La API de Airtm es de comercio, no de juego

De la documentación oficial:

> "The API doesn't grant access to other functionalities within the platform, like
> **P2P transactions**. At the moment, our API facilitates **payments between you
> and your customers**."

> "For transactions via API, the default currency is **USD** [...] the currency in
> Airtm is **USDC = USD**. [...] **Does the API support card or e-wallet payments?
> No.** [...] **Does the API handle crypto payments? No.**"

> "The amount and currency of the request **cannot be modified**."

Fuentes:
- https://help.airtm.com/en/support/solutions/articles/47001229394-about-processing-currencies-and-payment-methods
- https://help.airtm.com/en/support/solutions/articles/47001229393-about-api-credentials

Para usar la API hace falta:

1. Una cuenta de **empresa/merchant** verificada.
2. **2FA activo** en el inicio de sesión.
3. Generar credenciales en **Settings › Applications**.
4. El nombre de la credencial **se muestra al usuario** al confirmar el pago, así
   que debe ser el nombre de tu empresa o sitio.

Esto responde a la pregunta que dejamos abierta: **tu dirección
`airtm.me/taktak38847eb2` es de producto personal, no de comercio.** Sirve para
recibir pagos, pero no es la API de comercio ni tiene endpoint de pago
automático.

## 4. Cómo funciona de verdad un retiro por Airtm

Esto importa mucho para tu diseño. Según la documentación oficial, un retiro por
Airtm **no es un pago instantáneo por API**:

1. Pides el retiro en Airtm y eliges el método (banco, etc.).
2. **Airtm te conecta con otro usuario** que hace la transferencia a tu banco.
3. Ese usuario te avisa por Airtm de que pagó.
4. Tú compruebas en tu banco que llegó el dinero.
5. Tú pulsas **"Transfer Received"** en Airtm.
6. Calificas a la otra persona.

Fuente: https://help.airtm.com/en/support/solutions/articles/47001249479-how-to-withdraw-funds-from-deriv-to-your-bank-account

Es decir: **hay una persona en medio y una confirmación humana en el paso 5.** Eso
confirma que el diseño que ya tiene el código (cada retiro lo aprueba una persona)
no es una limitación nuestra, sino que coincide con cómo funciona Airtm.

## 5. Qué significa esto para Monopoly Tak Tak

| Pregunta | Respuesta |
|---|---|
| ¿Algún juego cobra y paga con Airtm? | No. Ninguno. Hay plataformas de dinero y tareas. |
| ¿Puedo usar mi dirección Airtm.me para cobrar? | Sí, para recibir. No es API de comercio ni pago automático. |
| ¿Puedo usar Airtm para un sorteo con apuesta sin licencia? | No. Es juego ilegal y Airtm está obligada a cerrarte la cuenta. |
| ¿Puedo usar Airtm para vender productos digitales? | Sí. Eso es exactamente para lo que existe su API de comercio. |
| ¿Venezuela está restringida por Airtm? | No. No aparece en la lista de regiones excluidas. |
| ¿Airtm paga de forma instantánea por API? | No. Un retiro pasa por una persona y una confirmación humana. |

### Consecuencia práctica

Si quieres cobrar con Airtm, el camino que **sí** existe es el de comercio:

1. Cuenta de empresa verificada en Airtm, con 2FA.
2. Credenciales en Settings › Applications, con el nombre de tu sitio (ese nombre
   lo verán los compradores).
3. Implementar la API de comercio (pagos de clientes → tu cuenta Airtm) usando la
   documentación oficial, que ya sabemos dónde está.
4. Los retiros, con aprobación humana, como ya está construido.

El bote con apuestas queda fuera mientras no haya licencia de operador. Esa parte
no cambia con esta investigación; la confirma.

## 6. Lo que sigue sin poder confirmar

- **El contenido exacto de la documentación técnica de la API de comercio.** La
  página de documentación existe y está enlazada, pero no pude abrirla desde este
  entorno. No invento rutas: `ENDPOINTS` sigue vacío a propósito.
- **Si Airtm aprueba juegos con licencia como caso de uso de comercio.** La
  cláusula prohíbe el juego *ilegal*, no todo el juego, pero eso hay que
  preguntárselo a Airtm por escrito, caso por caso.

Como dice el propio módulo entregado: *"Los datos que faltan no se solucionan
pegando una clave"*.
