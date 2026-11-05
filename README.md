# CAPSTREET

Tienda estática en español, preparada para publicarse en Render, con un servicio Node separado para autenticación de compra, Stripe Checkout y seguimiento de pedidos.

## Publicar en Render

El archivo `render.yaml` declara dos servicios:

- **capstreet-store**: Static Site, rama `main`, Root Directory vacío, Build Command vacío y Publish Directory `.`.
- **capstreet-api**: servicio Node que procesa sesiones de pago y webhooks.

Conecta el repositorio a Render y configura las variables marcadas como `sync: false` en el panel del servicio `capstreet-api`. No pongas claves secretas en `js/config.js` ni en el sitio estático.

## Configuración antes de aceptar compras

1. Supabase ya está configurado en `js/config.js` con la URL del proyecto y la clave publishable proporcionadas. La clave es pública por diseño; nunca uses aquí la clave `service_role`.
2. Ejecuta `supabase-schema.sql` en el SQL Editor del proyecto Supabase para crear las tablas y políticas de perfiles y pedidos.
3. En Supabase, permite como URL de redirección la URL de Render de la tienda y cualquier dominio local que uses para pruebas.
4. `SUPABASE_URL` y `SUPABASE_ANON_KEY` ya están definidos en `render.yaml`. En Render, configura `SUPABASE_SERVICE_ROLE_KEY`, `STRIPE_SECRET_KEY` y `STRIPE_WEBHOOK_SECRET` como secretos del servicio `capstreet-api`. No compartas ni incluyas la clave `service_role` en el frontend.
5. En `js/config.js`, ajusta `checkoutApiUrl` si el dominio de la API cambia.
6. En Stripe, crea un webhook apuntando a `https://TU-API.onrender.com/api/stripe-webhook` y habilita `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed` y `checkout.session.expired`. Copia su secreto de firma a `STRIPE_WEBHOOK_SECRET`.
7. Completa los campos entre corchetes de `privacy.html`, confirma el correo de contacto e identifica a la empresa de mensajería antes de publicar y operar la tienda.

Prueba primero con claves de prueba de Stripe. Los números de tarjeta se introducen únicamente en la página alojada de Stripe: CAPSTREET no recibe ni guarda números de tarjeta o códigos de seguridad.

## Desarrollo y comprobaciones

Requiere Node.js 20 o posterior:

```sh
npm ci
npm test
npm start
```

La API local usa `PORT=3001`. Copia `.env.example` a `.env` y completa valores de prueba fuera del repositorio para ejecutarla localmente. La tienda abierta desde `http://localhost:5500` se conecta a esa API local.

El servicio crea pedidos con precios obtenidos del catálogo del servidor. Por ahora no integra una paquetería ni cobra una tarifa de envío; define y configura esa operación antes de ofrecer entregas.
