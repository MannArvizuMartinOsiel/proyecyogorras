# CAPSTREET

Tienda estática en español con API de pagos separada para Render. El servidor calcula los importes desde `js/products.js`; nunca confía en precios enviados por el navegador.

## Pagos disponibles

- En el carrito, el cliente toca **Comprar** para abrir la selección de métodos de pago.
- **Stripe Checkout:** tarjetas (Visa, Mastercard y American Express según la cuenta), Apple Pay y Google Pay cuando Stripe y el dispositivo los habilitan. SPEI usa `mx_bank_transfer`. OXXO se ofrece solo si está habilitado para la cuenta Stripe; su pago puede tardar en confirmarse.
- **PayPal Checkout:** crea y captura órdenes en el servidor usando PayPal Orders v2. La captura se valida contra el pedido y el importe almacenado.
- En el carrito se pueden elegir color y talla, y canjear `CAP10` (10 %) o `STREET15` (15 %). La API valida el código y vuelve a calcular el descuento antes de crear un pago; los importes de Stripe y PayPal se basan en el catálogo del servidor.
- La API de Stripe ofrece `POST /create-checkout-session` y mantiene `POST /api/create-checkout-session` como alias compatible.

Stripe aloja la captura de datos de tarjeta; PayPal redirige a su propio sitio. CAPSTREET no recibe ni almacena números de tarjeta ni códigos de seguridad. Las claves de prueba y de producción deben mantenerse separadas.

## Variables de entorno de Render

Configúralas en el servicio Web `capstreet-api`:

| Variable | Requerida | Descripción |
|---|---|---|
| `SITE_ORIGIN` | Sí | Origen público exacto del Static Site, por ejemplo `https://capstreet-store.onrender.com`. |
| `SUPABASE_URL` | Sí | Ya está configurada en `render.yaml`. |
| `SUPABASE_ANON_KEY` | Sí | Clave pública de Supabase; ya está configurada. |
| `SUPABASE_SERVICE_ROLE_KEY` | Sí | Secreto de Supabase para guardar y actualizar pedidos. Nunca lo pongas en el frontend. |
| `STRIPE_SECRET_KEY` | Para Stripe | Clave secreta `sk_test_...` durante pruebas o `sk_live_...` en producción. |
| `STRIPE_PUBLISHABLE_KEY` | Recomendada | Clave pública `pk_test_...` o `pk_live_...`; el redirect a Checkout alojado no la necesita. |
| `STRIPE_WEBHOOK_SECRET` | Para Stripe | Secreto `whsec_...` del endpoint `/api/stripe-webhook`. |
| `PAYPAL_CLIENT_ID` | Para PayPal | Client ID de la app PayPal. |
| `PAYPAL_CLIENT_SECRET` | Para PayPal | Secreto de la app PayPal; mantenerlo solo en Render. |
| `PAYPAL_MODE` | Sí | `sandbox` para pruebas o `live` para cobros reales. El blueprint usa `sandbox`. |
| `PAYPAL_WEBHOOK_ID` | Recomendada | ID del webhook PayPal que apunta a `/api/paypal-webhook`; se usa para verificar su firma. |

Si un proveedor no tiene las variables necesarias, la API sigue funcionando, informa el método como no disponible y el checkout muestra un mensaje en vez de romper la tienda.

## Despliegue

1. En Supabase, ejecuta `supabase-schema.sql` en SQL Editor. Incluye columnas idempotentes para guardar pedidos Stripe, PayPal y descuentos promocionales.
2. En Supabase Auth, agrega la URL pública del Static Site a las URLs permitidas para confirmación de correo.
3. Conecta el repositorio a Render usando `render.yaml`. El Static Site usa rama `main`, Build Command vacío y Publish Directory `.`. El servicio Web `capstreet-api` usa `npm ci`, `npm start` y health check `/health`. Tras el despliegue, comprueba que `https://capstreet-api.onrender.com/health` responda `200` con JSON; si Render muestra otro dominio en el servicio, actualiza `checkoutApiUrl` en `js/config.js` con ese dominio.
4. Completa los secretos requeridos del servicio `capstreet-api` en el panel de Render. Mantén `PAYPAL_MODE=sandbox` y claves Stripe `test` al validar.
5. En Stripe Dashboard, habilita tarjetas, Bank Transfers y OXXO (si la cuenta es elegible). Añade un webhook a `https://TU-API.onrender.com/api/stripe-webhook` con `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed` y `checkout.session.expired`.
6. En PayPal Developer Dashboard, crea una app sandbox y un webhook a `https://TU-API.onrender.com/api/paypal-webhook` con el evento `PAYMENT.CAPTURE.COMPLETED`. Pon el `PAYPAL_WEBHOOK_ID` en Render.
7. Si Render asigna dominios distintos a los ejemplos, actualiza `SITE_ORIGIN` en Render y `checkoutApiUrl` en `js/config.js`.
8. Antes de activar modo live, completa los campos legales pendientes de `privacy.html`, confirma el correo de contacto, completa la información comercial solicitada por los proveedores y realiza una compra de prueba de cada método habilitado.

## Desarrollo

Requiere Node.js 20 o posterior:

```sh
npm ci
npm test
npm start
```

La API local usa `PORT=3001`; copia `.env.example` a `.env` y agrega credenciales de prueba. Sirve la tienda desde `http://localhost:5500` para evitar restricciones del protocolo `file:`.

No hay integración con una paquetería ni cálculo de envío. Configura esos procesos antes de ofrecer entregas.
