# GLENIS: la asistente de pagos de Monopoly TAK TAK

GLENIS es la asistente de IA que valida los pagos, acredita lo que está claro y
vigila los retiros. No es un adorno: es la que mira cada comprobante y arma el
expediente de cada retiro. Pero **no paga sola lo irreversible**: eso lo decide
el administrador.

## Qué hace y qué no

| Tarea | GLENIS | El administrador |
|---|---|---|
| Leer el comprobante de compra | Sí | — |
| Acreditar una compra clara | Sí, con confianza alta | Puede revisarla |
| Comprobante dudoso o repetido | Lo manda a revisión | Decide |
| Armar el expediente de un retiro | Sí | — |
| **Pagar un retiro** | **No** | Sí, siempre |
| Repartir el rol de administrador | No | Solo la cuenta madre |

## Los dos papeles y sus claves

GLENIS tiene dos trabajos, y cada uno necesita su clave:

1. **Leer comprobantes (visión).** Necesita `OPENAI_API_KEY`,
   `GEMINI_API_KEY` o `ANTHROPIC_API_KEY`. Sin ninguna, GLENIS **no puede leer
   las capturas** y **todos** los pagos van a revisión manual. No finge: prefiere
   no acreditar.
2. **Redactar (texto).** Aquí sirve `GROQ_API_KEY`. GLENIS escribe, en español
   claro, qué ve en cada expediente.

### Aviso importante sobre la clave de Groq

La clave de Groq disponible **no tiene modelos de visión**: su catálogo son
modelos de texto y de audio, sin ninguno que acepte imágenes. Por eso Groq
**nunca** se usa como lector de comprobantes; solo redacta. Si se usara como
visión, GLENIS aprobaría comprobantes sin haberlos leído, y eso es dinero
regalado. Hay una prueba que lo impide.

Para que GLENIS lea comprobantes de verdad hace falta una clave de visión. Es el
siguiente paso pendiente y está avisado en su propio panel.

## Reglas de decisión de las compras

- Un comprobante ya usado (mismo hash) no se acepta dos veces.
- El monto leído debe cubrir el monto de la orden.
- El destinatario debe ser la cuenta de cobro de la plataforma.
- Señales de edición en la imagen: rechazo.
- Confianza alta y sin señales: acredita. Duda: revisión manual.
- **Tope de autoaprobación:** tras 5 comprobantes aprobados en un día, GLENIS
  deja de aprobar sola y todo va a revisión. Una racha es señal de abuso.

## Control de retiros

GLENIS reúne el expediente de cada retiro y señala riesgos:

- KYC sin verificar, correo sin verificar, 2FA desactivado.
- Superar el límite diario de retiro.
- Varios retiros al mismo destino el mismo día (posible cuenta robada).

Y lo explica en palabras para el administrador. Pero la recomendación nunca es
"paga": es "parece correcto" o "revisar". El pago lo firma una persona.

## Registro de decisiones

Cada decisión de GLENIS y de cada administrador queda escrita: quién, qué, con
qué confianza, por qué y cuándo. Sin ese registro no hay control, y el panel lo
muestra.

## La cuenta madre

La cuenta madre es `eliecerdepablos@gmail.com`. Entra como administradora y es
la única que puede dar o quitar el rol de administrador a otras cuentas. Los
administradores ven el panel de GLENIS; los usuarios normales, no.

El registro es **solo con Gmail** (`ALLOWED_EMAIL_DOMAINS`), para reducir correos
desechables. Se puede ampliar con una lista separada por comas.

## Variables de entorno

```
GROQ_API_KEY=gsk_...            # redactar (no lee imágenes)
OPENAI_API_KEY=                 # leer comprobantes (visión)
GEMINI_API_KEY=
ANTHROPIC_API_KEY=
GLENIS_ENABLED=1                # 0 apaga a GLENIS
ALLOWED_EMAIL_DOMAINS=gmail.com
ADMIN_EMAILS=                   # cuentas madre extra, separadas por comas
```

## El límite que no se cruza

GLENIS es una ayuda para un negocio honesto, no una licencia. Validar pagos
recibidos y pagar retiros es dinero real: sigue necesitando licencia y
asesoría legal en Venezuela. GLENIS hace el trabajo pesado; la responsabilidad
de operar legalmente sigue siendo del dueño.
