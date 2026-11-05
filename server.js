const crypto = require("node:crypto");
require("dotenv").config();
const express = require("express");
const { createClient } = require("@supabase/supabase-js");
const Stripe = require("stripe");
const products = require("./js/products.js");

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const port = Number(process.env.PORT || 3001);
const siteOrigin = requiredEnv("SITE_ORIGIN").replace(/\/+$/, "");
const stripe = new Stripe(requiredEnv("STRIPE_SECRET_KEY"));
const webhookSecret = requiredEnv("STRIPE_WEBHOOK_SECRET");
const supabaseUrl = process.env.SUPABASE_URL || "https://medshszlajttiwfpsjol.supabase.co";
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || "sb_publishable_5JKhH6JITsProzdf2X_Zzw_9kbR1mnu";
const supabaseServiceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
const authClient = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});
const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});
const productById = new Map(products.map(product => [product.id, product]));
const allowedOrigins = new Set([
  siteOrigin,
  "http://localhost:5500",
  "http://127.0.0.1:5500"
]);
const app = express();

app.disable("x-powered-by");
app.use((req, res, next) => {
  const origin = req.get("origin");
  if (origin && !allowedOrigins.has(origin)) {
    return res.status(403).json({ error: "Origin not allowed." });
  }
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, Stripe-Signature");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

async function getAuthenticatedUser(req, res) {
  const authorization = req.get("authorization") || "";
  const tokenMatch = authorization.match(/^Bearer ([^\s]+)$/i);
  if (!tokenMatch) {
    res.status(401).json({ error: "Inicia sesión para continuar." });
    return null;
  }

  const { data, error } = await authClient.auth.getUser(tokenMatch[1]);
  if (error || !data.user) {
    res.status(401).json({ error: "Tu sesión ya no es válida. Inicia sesión de nuevo." });
    return null;
  }
  if (!data.user.email_confirmed_at && !data.user.confirmed_at) {
    res.status(403).json({ error: "Confirma tu correo antes de comprar." });
    return null;
  }
  return { user: data.user, token: tokenMatch[1] };
}

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.post("/api/create-checkout-session", express.json({ limit: "16kb" }), async (req, res) => {
  try {
    const authenticated = await getAuthenticatedUser(req, res);
    if (!authenticated) return;

    const { user } = authenticated;
    const items = req.body && req.body.items;
    if (!Array.isArray(items) || items.length === 0 || items.length > products.length) {
      return res.status(400).json({ error: "El carrito no es válido." });
    }

    const seenIds = new Set();
    const orderItems = [];
    for (const item of items) {
      const product = item && productById.get(item.id);
      if (!product || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 99 || seenIds.has(item.id)) {
        return res.status(400).json({ error: "El carrito contiene productos o cantidades no válidas." });
      }
      seenIds.add(item.id);
      orderItems.push({
        product_id: product.id,
        name: product.name,
        quantity: item.quantity,
        unit_amount: product.price * 100
      });
    }

    const orderId = crypto.randomUUID();
    const amount = orderItems.reduce((sum, item) => sum + item.unit_amount * item.quantity, 0);
    const checkoutSession = await stripe.checkout.sessions.create({
      mode: "payment",
      locale: "es-419",
      currency: "mxn",
      line_items: orderItems.map(item => ({
        quantity: item.quantity,
        price_data: {
          currency: "mxn",
          unit_amount: item.unit_amount,
          product_data: { name: `CAPSTREET · ${item.name}` }
        }
      })),
      customer_email: user.email,
      client_reference_id: user.id,
      billing_address_collection: "required",
      shipping_address_collection: { allowed_countries: ["MX"] },
      phone_number_collection: { enabled: true },
      success_url: `${siteOrigin}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteOrigin}/?checkout=cancel`,
      metadata: { order_id: orderId, user_id: user.id },
      payment_intent_data: { metadata: { order_id: orderId, user_id: user.id } }
    });

    const { error: orderError } = await adminClient.from("orders").insert({
      id: orderId,
      user_id: user.id,
      stripe_checkout_session_id: checkoutSession.id,
      amount,
      currency: "mxn",
      status: "pending",
      items: orderItems
    });
    if (orderError) {
      await stripe.checkout.sessions.expire(checkoutSession.id);
      console.error("Could not save pending order.", orderError);
      return res.status(503).json({ error: "No pudimos preparar el pedido. Intenta de nuevo." });
    }

    return res.status(201).json({ checkoutUrl: checkoutSession.url });
  } catch (error) {
    console.error("Could not create Stripe Checkout session.", error);
    return res.status(500).json({ error: "No pudimos iniciar el pago. Intenta de nuevo." });
  }
});

app.get("/api/checkout-session/:sessionId", async (req, res) => {
  try {
    const authenticated = await getAuthenticatedUser(req, res);
    if (!authenticated) return;

    const { user } = authenticated;
    const sessionId = req.params.sessionId;
    if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(sessionId)) {
      return res.status(400).json({ error: "La referencia de pago no es válida." });
    }
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.metadata.user_id !== user.id) {
      return res.status(404).json({ error: "No encontramos ese pedido." });
    }
    const { data: order, error } = await adminClient
      .from("orders")
      .select("id,status,amount,currency,created_at")
      .eq("stripe_checkout_session_id", sessionId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) throw error;
    if (!order) return res.status(404).json({ error: "No encontramos ese pedido." });

    if (session.payment_status === "paid" && order.status !== "paid") {
      const { error: updateError } = await adminClient
        .from("orders")
        .update({
          status: "paid",
          shipping_address: session.shipping_details?.address || null,
          customer_email: session.customer_details?.email || user.email
        })
        .eq("id", order.id);
      if (updateError) throw updateError;
      order.status = "paid";
    }

    return res.json({
      paymentStatus: session.payment_status,
      order: { ...order, amount: session.amount_total, currency: session.currency }
    });
  } catch (error) {
    console.error("Could not verify Stripe Checkout session.", error);
    return res.status(500).json({ error: "No pudimos verificar el pago. Contacta a CAPSTREET antes de volver a pagar." });
  }
});

app.post("/api/stripe-webhook", express.raw({ type: "application/json", limit: "1mb" }), async (req, res) => {
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.get("stripe-signature"), webhookSecret);
  } catch (error) {
    console.error("Invalid Stripe webhook signature.", error.message);
    return res.status(400).send("Invalid webhook signature.");
  }

  const session = event.data.object;
  if (
    event.type === "checkout.session.completed" ||
    event.type === "checkout.session.async_payment_succeeded"
  ) {
    const status = session.payment_status === "paid" ? "paid" : "pending";
    const { error } = await adminClient.from("orders").update({
      status,
      shipping_address: session.shipping_details?.address || null,
      customer_email: session.customer_details?.email || null
    }).eq("stripe_checkout_session_id", session.id);
    if (error) {
      console.error("Could not update paid order from Stripe webhook.", error);
      return res.status(500).send("Could not update order.");
    }
  } else if (event.type === "checkout.session.async_payment_failed") {
    const { error } = await adminClient.from("orders").update({ status: "failed" })
      .eq("stripe_checkout_session_id", session.id);
    if (error) {
      console.error("Could not mark failed order from Stripe webhook.", error);
      return res.status(500).send("Could not update order.");
    }
  } else if (event.type === "checkout.session.expired") {
    const { error } = await adminClient.from("orders").update({ status: "cancelled" })
      .eq("stripe_checkout_session_id", session.id);
    if (error) {
      console.error("Could not cancel expired order from Stripe webhook.", error);
      return res.status(500).send("Could not update order.");
    }
  }

  return res.json({ received: true });
});

app.use(express.json({ limit: "16kb" }));
app.use((req, res) => {
  res.status(404).json({ error: "Not found." });
});

app.listen(port, "0.0.0.0", () => {
  console.log(`CAPSTREET payment API listening on port ${port}.`);
});
