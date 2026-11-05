# CAPSTREET

Tienda estática en español con API de pagos separada para Render. El servidor calcula los importes desde `js/products.js`; nunca confía en precios enviados por el navegador.

## Pagos disponibles

- En el carrito, si solo hay un proveedor de pago habilitado, **Pagar con Stripe/PayPal** inicia ese checkout directamente. Si ambos están disponibles, **Continuar al pago** permite elegir; la compra sigue requiriendo iniciar sesión.
- **Stripe Checkout:** tarjetas (Visa, Mastercard y American Express según la cuenta), Apple Pay y Google Pay cuando Stripe y el dispositivo los habilitan. SPEI usa `mx_bank_transfer`. OXXO se ofrece solo si está habilitado para la cuenta Stripe; su pago puede tardar en confirmarse.
- **PayPal Checkout:** crea y captura órdenes en el servidor usando PayPal Orders v2. La captura se valida contra el pedido y el importe almacenado.
- En el carrito se pueden elegir color y talla, y canjear `CAP10` (10 %) o `STREET15` (15 %). La API valida el código y vuelve a calcular el descuento antes de crear un pago; los importes de Stripe y PayPal se basan en el catálogo del servidor.
- La API de Stripe ofrece `POST /create-checkout-session` y mantiene `POST /api/create-checkout-session` como alias compatible.

Stripe aloja la captura de datos de tarjeta; PayPal redirige a su propio sitio. CAPSTREET no recibe ni almacena números de tarjeta ni códigos de seguridad. Las claves de prueba y de producción deben mantenerse separadas.

## Administración del catálogo

- Ejecuta `supabase-schema.sql` en Supabase para crear y actualizar las tablas privadas `admin_products` y `admin_product_overrides`, junto con el bucket de imágenes. Vuelve a ejecutar el archivo después de cada cambio del esquema del catálogo.
- En Render, configura `ADMIN_EMAILS` con los correos autorizados, separados por comas. Cada cuenta debe existir en Supabase Auth y tener el correo confirmado. El servidor valida la sesión y la lista autorizada; no confíes en ocultar la URL como medida de acceso.
- Abre `/admin.html`, inicia sesión y agrega, edita o quita artículos. Los cambios se reflejan en la tienda y en el checkout; los productos iniciales se quitan de forma lógica para conservar sus datos relacionados.
- Al agregar o editar artículos se puede subir, reemplazar o quitar una imagen JPG, PNG o WebP de hasta 4 MB. Se guarda en el bucket público `product-images` de Supabase Storage y aparece en la tienda. Los artículos sin imagen conservan la ilustración predeterminada.

## Variables de entorno de Render

Configúralas en el servicio Web `capstreet-backend`:

| Variable | Requerida | Descripción |
|---|---|---|
| `SITE_ORIGIN` | Sí | Origen público exacto del Static Site: `https://proyecyogorras.onrender.com`. |
| `SUPABASE_URL` | Sí | Ya está configurada en `render.yaml`. |
| `SUPABASE_ANON_KEY` | Sí | Clave pública de Supabase; ya está configurada. |
| `SUPABASE_SERVICE_ROLE_KEY` | Sí | Secreto de Supabase para guardar y actualizar pedidos. Nunca lo pongas en el frontend. |
| `ADMIN_EMAILS` | Para el panel | Correos confirmados de Supabase Auth autorizados a crear artículos, separados por comas. |
| `STRIPE_SECRET_KEY` | Para Stripe | Clave secreta `sk_test_...` durante pruebas o `sk_live_...` en producción. |
| `STRIPE_PUBLISHABLE_KEY` | Recomendada | Clave pública `pk_test_...` o `pk_live_...`; el redirect a Checkout alojado no la necesita. |
| `STRIPE_WEBHOOK_SECRET` | Para Stripe | Secreto `whsec_...` del endpoint `/api/stripe-webhook`. |
| `PAYPAL_CLIENT_ID` | Para PayPal | Client ID de la app PayPal. |
| `PAYPAL_CLIENT_SECRET` | Para PayPal | Secreto de la app PayPal; mantenerlo solo en Render. |
| `PAYPAL_MODE` | Sí | `sandbox` para pruebas o `live` para cobros reales. El blueprint usa `sandbox`. |
| `PAYPAL_WEBHOOK_ID` | Recomendada | ID del webhook PayPal que apunta a `/api/paypal-webhook`; se usa para verificar su firma. |

Si un proveedor no tiene las variables necesarias, la API sigue funcionando, informa el método como no disponible y el checkout muestra un mensaje en vez de romper la tienda.

Si Render muestra `Invalid supabaseUrl`, fija `SUPABASE_URL` al URL exacto del proyecto en Supabase (`https://medshszlajttiwfpsjol.supabase.co`) sin comillas ni espacios. Si muestra `Invalid API key`, reemplaza en el servicio `capstreet-backend` tanto `SUPABASE_ANON_KEY` por la publishable/anon key como `SUPABASE_SERVICE_ROLE_KEY` por la secret/service_role key del mismo proyecto. No uses la publishable key en el campo de service role. Guarda los cambios y haz un redeploy; `/health` muestra si las claves tienen formato configurado, pero no sustituye la verificación de credenciales en Supabase.

## Despliegue

1. En Supabase, ejecuta `supabase-schema.sql` en SQL Editor. Incluye las tablas para pedidos, descuentos promocionales, el campo de imagen del catálogo y la configuración del bucket público de imágenes.
2. En Supabase Auth, agrega la URL pública del Static Site a las URLs permitidas para confirmación de correo.
3. Conecta el repositorio a Render usando `render.yaml`. El Static Site `proyecyogorras` usa rama `main`, Build Command vacío y Publish Directory `.`. El servicio Web `capstreet-backend` usa `npm ci`, `npm start` y health check `/health`. Tras el despliegue, comprueba que `https://capstreet-backend.onrender.com/health` responda `200` con JSON; si Render asigna otro dominio, actualiza `checkoutApiUrl` en `js/config.js` y `SITE_ORIGIN` en el Web Service.
4. Completa los secretos requeridos del servicio `capstreet-backend` en el panel de Render. Mantén `PAYPAL_MODE=sandbox` y claves Stripe `test` al validar.
5. En Stripe Dashboard, habilita tarjetas, Bank Transfers y OXXO (si la cuenta es elegible). Añade un webhook a `https://capstreet-backend.onrender.com/api/stripe-webhook` con `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed` y `checkout.session.expired`.
6. En PayPal Developer Dashboard, crea una app sandbox y un webhook a `https://capstreet-backend.onrender.com/api/paypal-webhook` con el evento `PAYMENT.CAPTURE.COMPLETED`. Pon el `PAYPAL_WEBHOOK_ID` en Render.
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
