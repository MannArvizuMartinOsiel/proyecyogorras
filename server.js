const crypto = require("node:crypto");
require("dotenv").config();
const express = require("express");
const { createClient } = require("@supabase/supabase-js");
const Stripe = require("stripe");
const products = require("./js/products.js");

const PRODUCT_TYPES = {
  cap: "Gorras",
  shirt: "Ropa",
  hoodie: "Ropa",
  chain: "Joyería",
  bracelet: "Joyería",
  sneaker: "Tenis"
};
const PRODUCT_IMAGE_BUCKET = "product-images";
const MAX_PRODUCT_IMAGE_BYTES = 4 * 1024 * 1024;
const PRODUCT_IMAGE_TYPES = new Map([
  ["image/jpeg", { extension: "jpg", signature: bytes => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff }],
  ["image/png", { extension: "png", signature: bytes => bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) }],
  ["image/webp", { extension: "webp", signature: bytes => bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP" }]
]);

function configuredEnv(name) {
  const rawValue = process.env[name]?.trim();
  const value = rawValue?.replace(/^(['"])(.*)\1$/, "$2").trim();
  return value && !/PEGA_AQUI|TU-PROYECTO/i.test(value) ? value : null;
}

function validSupabaseUrl(value) {
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") &&
      Boolean(url.hostname) &&
      !url.username &&
      !url.password;
  } catch {
    return false;
  }
}

function validSupabaseKey(value, kind) {
  if (!value) return false;
  if (/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) return true;
  const prefix = kind === "secret" ? "sb_secret_" : "sb_publishable_";
  return value.startsWith(prefix) && /^[A-Za-z0-9_-]+$/.test(value.slice(prefix.length));
}

const port = Number(process.env.PORT || 3001);
const siteOrigin = new URL(process.env.SITE_ORIGIN || "http://localhost:5500").origin;
const defaultSupabaseUrl = "https://medshszlajttiwfpsjol.supabase.co";
const defaultSupabaseAnonKey = "sb_publishable_5JKhH6JITsProzdf2X_Zzw_9kbR1mnu";
const configuredSupabaseUrl = configuredEnv("SUPABASE_URL");
const supabaseUrl = validSupabaseUrl(configuredSupabaseUrl)
  ? configuredSupabaseUrl
  : defaultSupabaseUrl;
if (configuredSupabaseUrl && !validSupabaseUrl(configuredSupabaseUrl)) {
  console.error("Invalid SUPABASE_URL. Using the configured CAPSTREET project URL; correct SUPABASE_URL in Render.");
}
const supabaseAnonCandidate = configuredEnv("SUPABASE_ANON_KEY") || defaultSupabaseAnonKey;
const supabaseAnonKey = validSupabaseKey(supabaseAnonCandidate, "publishable")
  ? supabaseAnonCandidate
  : null;
if (!supabaseAnonKey) {
  console.error("Invalid SUPABASE_ANON_KEY. Use the publishable or legacy anon key from the CAPSTREET Supabase project.");
}
const supabaseServiceRoleCandidate = configuredEnv("SUPABASE_SERVICE_ROLE_KEY");
const supabaseServiceRoleKey = validSupabaseKey(supabaseServiceRoleCandidate, "secret")
  ? supabaseServiceRoleCandidate
  : null;
if (supabaseServiceRoleCandidate && !supabaseServiceRoleKey) {
  console.error("Invalid SUPABASE_SERVICE_ROLE_KEY format. Use a secret or legacy service_role key from the CAPSTREET Supabase project.");
}
const stripeSecretCandidate = configuredEnv("STRIPE_SECRET_KEY");
const stripePublishableCandidate = configuredEnv("STRIPE_PUBLISHABLE_KEY");
const stripeSecretKey = stripeSecretCandidate && /^sk_(test|live)_[A-Za-z0-9]+$/.test(stripeSecretCandidate)
  ? stripeSecretCandidate
  : null;
const stripePublishableKey = stripePublishableCandidate && /^pk_(test|live)_[A-Za-z0-9]+$/.test(stripePublishableCandidate)
  ? stripePublishableCandidate
  : "";
const stripeWebhookSecret = configuredEnv("STRIPE_WEBHOOK_SECRET");
const paypalClientId = configuredEnv("PAYPAL_CLIENT_ID");
const paypalClientSecret = configuredEnv("PAYPAL_CLIENT_SECRET");
const paypalWebhookId = configuredEnv("PAYPAL_WEBHOOK_ID");
const adminEmails = new Set((process.env.ADMIN_EMAILS || "")
  .split(",")
  .map(email => email.trim().toLowerCase())
  .filter(Boolean));
const PROMO_CODES = new Map([["CAP10", 10], ["STREET15", 15]]);
const paypalMode = process.env.PAYPAL_MODE || "sandbox";
if (!["sandbox", "live"].includes(paypalMode)) {
  throw new Error("PAYPAL_MODE must be either 'sandbox' or 'live'.");
}
const paypalBaseUrl = paypalMode === "live"
  ? "https://api-m.paypal.com"
  : "https://api-m.sandbox.paypal.com";
const stripe = stripeSecretKey ? new Stripe(stripeSecretKey) : null;
const authClient = supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  })
  : null;
const adminClient = supabaseServiceRoleKey
  ? createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  })
  : null;
let serviceRoleKeyRejected = false;
const allowedOrigins = new Set([
  siteOrigin,
  "http://localhost:5500",
  "http://127.0.0.1:5500",
  "http://localhost:5501",
  "http://127.0.0.1:5501"
]);
const app = express();

app.disable("x-powered-by");
app.use((req, res, next) => {
  const origin = req.get("origin");
  if (origin && !allowedOrigins.has(origin)) {
    return res.status(403).json({ error: "Origen no permitido." });
  }
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, Stripe-Signature, PayPal-Auth-Algo, PayPal-Cert-Url, PayPal-Transmission-Id, PayPal-Transmission-Sig, PayPal-Transmission-Time");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

function providerReady(provider) {
  if (!authClient || !adminClient) return false;
  return provider === "stripe"
    ? Boolean(stripe)
    : Boolean(paypalClientId && paypalClientSecret);
}

function requireProvider(provider, res) {
  if (!authClient || !adminClient) {
    res.status(503).json({
      error: "El servicio de pedidos todavía no está configurado. Intenta más tarde."
    });
    return false;
  }
  if (provider === "stripe" && !stripe) {
    res.status(503).json({
      error: "Stripe no está configurado todavía. Elige PayPal o intenta más tarde."
    });
    return false;
  }
  if (provider === "paypal" && (!paypalClientId || !paypalClientSecret)) {
    res.status(503).json({
      error: "PayPal no está configurado todavía. Elige Stripe o intenta más tarde."
    });
    return false;
  }
  return true;
}

async function getAuthenticatedUser(req, res) {
  const authorization = req.get("authorization") || "";
  const tokenMatch = authorization.match(/^Bearer\s+(.+)$/i);
  if (!tokenMatch || !authClient) {
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
  return { user: data.user };
}

async function getAdminUser(req, res) {
  if (!adminEmails.size || !authClient || !adminClient) {
    res.status(503).json({ error: "El panel de administración no está configurado." });
    return null;
  }
  const authorization = req.get("authorization") || "";
  const tokenMatch = authorization.match(/^Bearer\s+(.+)$/i);
  if (!tokenMatch) {
    res.status(401).json({ error: "Inicia sesión con una cuenta autorizada." });
    return null;
  }
  const { data, error } = await authClient.auth.getUser(tokenMatch[1]);
  if (error || !data.user) {
    res.status(401).json({ error: "Tu sesión ya no es válida. Inicia sesión de nuevo." });
    return null;
  }
  if (!data.user.email_confirmed_at && !data.user.confirmed_at) {
    res.status(403).json({ error: "Confirma tu correo para administrar el catálogo." });
    return null;
  }
  if (!adminEmails.has(data.user.email?.toLowerCase() || "")) {
    res.status(403).json({ error: "Esta cuenta no tiene acceso al panel de administración." });
    return null;
  }
  return data.user;
}

function formatAdminProduct(row) {
  const template = products.find(product => product.type === row.type);
  if (!template) throw new Error(`Unknown product type in catalog: ${row.type}`);
  return {
    ...template,
    ...row,
    tag: "",
    image_url: row.image_url || null,
    colorOptions: template.colorOptions,
    sizeOptions: template.sizeOptions
  };
}

async function getProductCatalog() {
  if (!adminClient) return products;
  if (serviceRoleKeyRejected) {
    const error = new Error("Supabase rechazó SUPABASE_SERVICE_ROLE_KEY. Verifica la clave en Render.");
    error.code = "SUPABASE_SERVICE_ROLE_KEY_REJECTED";
    throw error;
  }
  const { data, error } = await adminClient
    .from("admin_products")
    .select("id,department,category,type,name,description,price,color,brim,patch,label,image_url")
    .order("id", { ascending: true });
  if (error) {
    if (/invalid api key/i.test(`${error.message || ""} ${error.hint || ""}`)) {
      serviceRoleKeyRejected = true;
      console.error("Supabase rechazó SUPABASE_SERVICE_ROLE_KEY. Verifica que sea la clave secreta del proyecto CAPSTREET en Render.");
      const configurationError = new Error("Supabase rechazó SUPABASE_SERVICE_ROLE_KEY. Verifica la clave en Render.");
      configurationError.code = "SUPABASE_SERVICE_ROLE_KEY_REJECTED";
      throw configurationError;
    }
    throw error;
  }
  return [...products, ...data.map(formatAdminProduct)];
}

function getOrderItems(items, catalog) {
  if (!Array.isArray(items) || items.length === 0 || items.length > 100) {
    return { error: "El carrito no es válido." };
  }

  const productById = new Map(catalog.map(product => [product.id, product]));
  const seenIds = new Set();
  const orderItems = [];
  for (const item of items) {
    const product = item && productById.get(item.id);
    const color = product?.colorOptions.find(option => option.id === item.color);
    const size = product?.sizeOptions.includes(item.size) ? item.size : null;
    const variantId = product ? `${product.id}|${item.color}|${item.size}` : "";
    if (!product || !color || !size || !Number.isInteger(item.quantity) || item.quantity < 1 ||
        item.quantity > 99 || seenIds.has(variantId)) {
      return { error: "El carrito contiene productos o cantidades no válidas." };
    }
    seenIds.add(variantId);
    orderItems.push({
      product_id: product.id,
      name: product.name,
      color_id: color.id,
      color: color.label,
      size,
      quantity: item.quantity,
      unit_amount: product.price * 100
    });
  }
  return { items: orderItems };
}

function orderTotal(items) {
  return items.reduce((sum, item) => sum + item.unit_amount * item.quantity, 0);
}

function getOrderPricing(items, submittedCode) {
  const code = typeof submittedCode === "string" ? submittedCode.trim().toUpperCase() : "";
  const percentOff = code ? PROMO_CODES.get(code) : 0;
  if (code && !percentOff) return { error: "Ese código promocional no es válido." };

  const subtotal = orderTotal(items);
  const discountedItems = percentOff
    ? items.map(item => ({
      ...item,
      unit_amount: item.unit_amount - Math.round(item.unit_amount * percentOff / 100)
    }))
    : items;
  const amount = orderTotal(discountedItems);
  return {
    code: code || null,
    percentOff,
    subtotal,
    discountAmount: subtotal - amount,
    amount,
    discountedItems
  };
}

function decimalToMinorUnits(value) {
  if (typeof value !== "string" || !/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

async function getPayPalAccessToken() {
  const authorization = Buffer.from(`${paypalClientId}:${paypalClientSecret}`).toString("base64");
  const response = await fetch(`${paypalBaseUrl}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${authorization}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(15000)
  });
  const result = await response.json();
  if (!response.ok || !result.access_token) {
    console.error("PayPal token request failed.", result);
    throw new Error("PayPal no pudo iniciar sesión. Revisa las credenciales de PayPal en Render.");
  }
  return result.access_token;
}

async function paypalRequest(path, { method = "GET", body, requestId } = {}) {
  const accessToken = await getPayPalAccessToken();
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json"
  };
  if (requestId) headers["PayPal-Request-Id"] = requestId;

  const response = await fetch(`${paypalBaseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000)
  });
  const result = await response.json();
  if (!response.ok) {
    console.error("PayPal API request failed.", { status: response.status, result });
    const error = new Error("PayPal no pudo procesar la solicitud. Revisa la configuración y vuelve a intentar.");
    error.status = response.status;
    throw error;
  }
  return result;
}

async function savePaidPayPalOrder(order, capture) {
  const purchaseUnit = capture.purchase_units?.[0];
  const capturedPayment = purchaseUnit?.payments?.captures?.find(payment => payment.status === "COMPLETED");
  const capturedAmount = decimalToMinorUnits(capturedPayment?.amount?.value);
  if (
    capture.status !== "COMPLETED" ||
    !capturedPayment ||
    capturedAmount !== order.amount ||
    capturedPayment.amount.currency_code?.toLowerCase() !== order.currency.toLowerCase()
  ) {
    throw new Error("PayPal no confirmó el importe completo del pedido.");
  }

  const { error } = await adminClient.from("orders").update({
    status: "paid",
    customer_email: capture.payer?.email_address || order.customer_email,
    shipping_address: purchaseUnit.shipping || null
  }).eq("id", order.id);
  if (error) throw error;
}

app.get("/", (_req, res) => {
  res.json({ service: "capstreet-api", status: "ok", health: "/health" });
});

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    supabase: {
      authKeyConfigured: Boolean(authClient),
      serviceRoleKeyConfigured: Boolean(adminClient)
    },
    payments: {
      stripe: providerReady("stripe"),
      paypal: providerReady("paypal")
    }
  });
});

app.get("/api/payment-options", (_req, res) => {
  const stripeEnabled = providerReady("stripe");
  res.json({
    stripe: stripeEnabled,
    paypal: providerReady("paypal"),
    methods: {
      cards: stripeEnabled,
      spei: stripeEnabled,
      oxxo: stripeEnabled,
      applePay: stripeEnabled,
      googlePay: stripeEnabled
    },
    stripePublishableKey: stripePublishableKey || null
  });
});

app.get("/api/products", async (_req, res) => {
  try {
    return res.json({ products: await getProductCatalog() });
  } catch (error) {
    if (error.code === "SUPABASE_SERVICE_ROLE_KEY_REJECTED") {
      return res.json({ products, source: "bundled" });
    }
    console.error("Could not load product catalog.", error);
    return res.status(503).json({ error: "No pudimos cargar el catálogo actualizado." });
  }
});

app.get("/api/admin/products", async (req, res) => {
  try {
    if (!await getAdminUser(req, res)) return;
    const catalog = await getProductCatalog();
    return res.json({ products: catalog.filter(product => !products.some(item => item.id === product.id)) });
  } catch (error) {
    if (error.code !== "SUPABASE_SERVICE_ROLE_KEY_REJECTED") {
      console.error("Could not load admin product catalog.", error);
    }
    if (error.code === "SUPABASE_SERVICE_ROLE_KEY_REJECTED") {
      return res.status(503).json({
        error: "Supabase rechazó la clave secreta del servidor. Actualiza SUPABASE_SERVICE_ROLE_KEY en Render."
      });
    }
    return res.status(503).json({ error: "No pudimos cargar los artículos. Verifica la configuración del catálogo." });
  }
});

app.post("/api/admin/products", express.json({ limit: "6mb" }), async (req, res) => {
  let uploadedImagePath = null;
  try {
    if (!await getAdminUser(req, res)) return;
    const { name, description, price, type, category, imageData } = req.body || {};
    const department = PRODUCT_TYPES[type];
    if (
      typeof name !== "string" || !name.trim() || name.trim().length > 80 ||
      typeof description !== "string" || !description.trim() || description.trim().length > 300 ||
      !department || !Number.isSafeInteger(price) || price < 1 || price > 1000000 ||
      (category !== undefined && (typeof category !== "string" || category.trim().length > 40))
    ) {
      return res.status(400).json({ error: "Revisa nombre, descripción, categoría, tipo y precio del artículo." });
    }

    let imageUrl = null;
    if (imageData !== undefined && imageData !== null && imageData !== "") {
      if (typeof imageData !== "string") {
        return res.status(400).json({ error: "La imagen del producto no es válida." });
      }
      const match = imageData.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
      if (!match) {
        return res.status(400).json({ error: "Usa una imagen JPG, PNG o WebP válida." });
      }
      const [, contentType, encodedImage] = match;
      const imageBuffer = Buffer.from(encodedImage, "base64");
      const imageType = PRODUCT_IMAGE_TYPES.get(contentType);
      if (
        imageBuffer.length === 0 ||
        imageBuffer.length > MAX_PRODUCT_IMAGE_BYTES ||
        !imageType.signature(imageBuffer)
      ) {
        return res.status(400).json({ error: "La imagen está vacía, supera 4 MB o su contenido no coincide con el formato." });
      }
      uploadedImagePath = `${crypto.randomUUID()}.${imageType.extension}`;
      const { error: uploadError } = await adminClient.storage
        .from(PRODUCT_IMAGE_BUCKET)
        .upload(uploadedImagePath, imageBuffer, {
          contentType,
          cacheControl: "31536000",
          upsert: false
        });
      if (uploadError) {
        console.error("Could not upload admin product image.", uploadError);
        return res.status(503).json({
          error: "No pudimos subir la imagen. Verifica que el bucket product-images exista en Supabase."
        });
      }
      imageUrl = adminClient.storage.from(PRODUCT_IMAGE_BUCKET).getPublicUrl(uploadedImagePath).data.publicUrl;
    }

    const template = products.find(product => product.type === type);
    const { data, error } = await adminClient.from("admin_products").insert({
      department,
      category: category?.trim() || null,
      type,
      name: name.trim(),
      description: description.trim(),
      price,
      color: template.color,
      brim: template.brim,
      patch: template.patch || null,
      label: template.label,
      image_url: imageUrl
    }).select("id,department,category,type,name,description,price,color,brim,patch,label,image_url").single();
    if (error) throw error;
    uploadedImagePath = null;
    return res.status(201).json({ product: formatAdminProduct(data) });
  } catch (error) {
    console.error("Could not create admin product.", error);
    if (uploadedImagePath && adminClient) {
      const { error: cleanupError } = await adminClient.storage
        .from(PRODUCT_IMAGE_BUCKET)
        .remove([uploadedImagePath]);
      if (cleanupError) console.error("Could not remove orphaned admin product image.", cleanupError);
    }
    return res.status(503).json({ error: "No pudimos guardar el artículo. Intenta de nuevo." });
  }
});

app.post("/api/validate-promo", express.json({ limit: "16kb" }), async (req, res) => {
  try {
    const catalog = await getProductCatalog();
    const validated = getOrderItems(req.body?.items, catalog);
    if (validated.error) return res.status(400).json({ error: validated.error });
    const pricing = getOrderPricing(validated.items, req.body?.code);
    if (pricing.error) return res.status(400).json({ error: pricing.error });
    return res.json({
      code: pricing.code,
      percentOff: pricing.percentOff,
      subtotal: pricing.subtotal,
      discountAmount: pricing.discountAmount,
      amount: pricing.amount,
      currency: "mxn"
    });
  } catch (error) {
    console.error("Could not validate promotion against product catalog.", error);
    return res.status(503).json({ error: "No pudimos validar el código con el catálogo actualizado." });
  }
});

const createStripeCheckoutSession = async (req, res) => {
  if (!requireProvider("stripe", res)) return;
  try {
    const authenticated = await getAuthenticatedUser(req, res);
    if (!authenticated) return;

    const catalog = await getProductCatalog();
    const validated = getOrderItems(req.body?.items, catalog);
    if (validated.error) return res.status(400).json({ error: validated.error });
    const { user } = authenticated;
    const orderItems = validated.items;
    const pricing = getOrderPricing(orderItems, req.body?.promoCode);
    if (pricing.error) return res.status(400).json({ error: pricing.error });
    const { amount } = pricing;
    const orderId = crypto.randomUUID();
    const customer = await stripe.customers.create({
      email: user.email,
      metadata: { supabase_user_id: user.id }
    });
    const checkoutOptions = {
      mode: "payment",
      locale: "es-419",
      currency: "mxn",
      customer: customer.id,
      line_items: pricing.discountedItems.map(item => ({
        quantity: item.quantity,
        price_data: {
          currency: "mxn",
          unit_amount: item.unit_amount,
          product_data: {
            name: `CAPSTREET · ${item.name}`,
            description: `${item.color} · ${item.size}`
          }
        }
      })),
      billing_address_collection: "required",
      shipping_address_collection: { allowed_countries: ["MX"] },
      phone_number_collection: { enabled: true },
      success_url: `${siteOrigin}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteOrigin}/?checkout=cancel`,
      client_reference_id: user.id,
      metadata: {
        order_id: orderId,
        user_id: user.id,
        promo_code: pricing.code || "",
        discount_amount: String(pricing.discountAmount)
      },
      payment_intent_data: { metadata: { order_id: orderId, user_id: user.id } }
    };
    let checkoutSession;
    try {
      checkoutSession = await stripe.checkout.sessions.create({
        ...checkoutOptions,
        payment_method_options: {
          customer_balance: {
            funding_type: "bank_transfer",
            bank_transfer: { type: "mx_bank_transfer" }
          }
        }
      });
    } catch (error) {
      const bankTransferError = `${error.param || ""} ${error.message || ""}`.toLowerCase();
      if (!bankTransferError.includes("customer_balance") && !bankTransferError.includes("mx_bank_transfer")) {
        throw error;
      }
      console.warn("Stripe bank transfers are unavailable for this account; retrying with other enabled methods.", error.code || error.message);
      checkoutSession = await stripe.checkout.sessions.create(checkoutOptions);
    }

    const { error: orderError } = await adminClient.from("orders").insert({
      id: orderId,
      user_id: user.id,
      stripe_checkout_session_id: checkoutSession.id,
      payment_provider: "stripe",
      subtotal: pricing.subtotal,
      discount_amount: pricing.discountAmount,
      promo_code: pricing.code,
      amount,
      currency: "mxn",
      status: "pending",
      items: orderItems,
      customer_email: user.email
    });
    if (orderError) {
      await stripe.checkout.sessions.expire(checkoutSession.id);
      console.error("Could not save pending Stripe order.", orderError);
      return res.status(503).json({ error: "No pudimos guardar el pedido antes del pago. Intenta de nuevo." });
    }

    return res.status(201).json({ checkoutUrl: checkoutSession.url });
  } catch (error) {
    console.error("Could not create Stripe Checkout session.", error);
    return res.status(502).json({
      error: "Stripe no pudo preparar el pago. Confirma los métodos habilitados en Stripe y vuelve a intentar."
    });
  }
};

app.post("/create-checkout-session", express.json({ limit: "16kb" }), createStripeCheckoutSession);
app.post("/api/create-checkout-session", express.json({ limit: "16kb" }), createStripeCheckoutSession);

app.post("/api/paypal/create-order", express.json({ limit: "16kb" }), async (req, res) => {
  if (!requireProvider("paypal", res)) return;
  let orderId;
  try {
    const authenticated = await getAuthenticatedUser(req, res);
    if (!authenticated) return;

    const catalog = await getProductCatalog();
    const validated = getOrderItems(req.body?.items, catalog);
    if (validated.error) return res.status(400).json({ error: validated.error });
    const { user } = authenticated;
    const orderItems = validated.items;
    const pricing = getOrderPricing(orderItems, req.body?.promoCode);
    if (pricing.error) return res.status(400).json({ error: pricing.error });
    const { amount } = pricing;
    orderId = crypto.randomUUID();

    const { error: insertError } = await adminClient.from("orders").insert({
      id: orderId,
      user_id: user.id,
      payment_provider: "paypal",
      subtotal: pricing.subtotal,
      discount_amount: pricing.discountAmount,
      promo_code: pricing.code,
      amount,
      currency: "mxn",
      status: "pending",
      items: orderItems,
      customer_email: user.email
    });
    if (insertError) throw insertError;

    const paypalOrder = await paypalRequest("/v2/checkout/orders", {
      method: "POST",
      requestId: orderId,
      body: {
        intent: "CAPTURE",
        purchase_units: [{
          reference_id: orderId,
          custom_id: orderId,
          invoice_id: orderId,
          description: "Compra CAPSTREET",
          amount: { currency_code: "MXN", value: (amount / 100).toFixed(2) }
        }],
        application_context: {
          brand_name: "CAPSTREET",
          locale: "es-MX",
          user_action: "PAY_NOW",
          shipping_preference: "GET_FROM_FILE",
          return_url: `${siteOrigin}/?paypal=success`,
          cancel_url: `${siteOrigin}/?paypal=cancel`
        }
      }
    });
    const approvalLink = paypalOrder.links?.find(link => link.rel === "approve" || link.rel === "payer-action");
    if (!paypalOrder.id || !approvalLink?.href) {
      throw new Error("PayPal no devolvió un enlace de aprobación.");
    }

    const { error: updateError } = await adminClient.from("orders")
      .update({ paypal_order_id: paypalOrder.id })
      .eq("id", orderId);
    if (updateError) throw updateError;
    return res.status(201).json({ checkoutUrl: approvalLink.href });
  } catch (error) {
    if (orderId) {
      const { error: updateError } = await adminClient.from("orders")
        .update({ status: "failed" })
        .eq("id", orderId);
      if (updateError) console.error("Could not mark failed PayPal order.", updateError);
    }
    console.error("Could not create PayPal order.", error);
    return res.status(502).json({
      error: error.message || "PayPal no pudo iniciar el pago. Intenta más tarde."
    });
  }
});

app.post("/api/paypal/orders/:orderId/capture", express.json({ limit: "4kb" }), async (req, res) => {
  if (!requireProvider("paypal", res)) return;
  try {
    const authenticated = await getAuthenticatedUser(req, res);
    if (!authenticated) return;
    const { user } = authenticated;
    const paypalOrderId = req.params.orderId;
    if (!/^[A-Z0-9-]{8,64}$/i.test(paypalOrderId)) {
      return res.status(400).json({ error: "La referencia de PayPal no es válida." });
    }

    const { data: order, error: lookupError } = await adminClient.from("orders")
      .select("id,user_id,paypal_order_id,amount,currency,status,customer_email")
      .eq("paypal_order_id", paypalOrderId)
      .eq("user_id", user.id)
      .eq("payment_provider", "paypal")
      .maybeSingle();
    if (lookupError) throw lookupError;
    if (!order) return res.status(404).json({ error: "No encontramos ese pedido de PayPal." });
    if (order.status === "paid") return res.json({ status: "COMPLETED", order });

    const capture = await paypalRequest(`/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}/capture`, {
      method: "POST",
      requestId: crypto.createHash("sha256").update(`${order.id}:capture`).digest("hex").slice(0, 32),
      body: {}
    });
    await savePaidPayPalOrder(order, capture);
    return res.json({ status: "COMPLETED", order: { ...order, status: "paid" } });
  } catch (error) {
    console.error("Could not capture PayPal order.", error);
    return res.status(502).json({
      error: error.message || "No pudimos confirmar el pago de PayPal. No vuelvas a pagar; intenta verificar el pedido."
    });
  }
});

app.get("/api/checkout-session/:sessionId", async (req, res) => {
  if (!requireProvider("stripe", res)) return;
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
    const { data: order, error } = await adminClient.from("orders")
      .select("id,status,amount,currency,created_at")
      .eq("stripe_checkout_session_id", sessionId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) throw error;
    if (!order) return res.status(404).json({ error: "No encontramos ese pedido." });

    if (session.payment_status === "paid" && order.status !== "paid") {
      const { error: updateError } = await adminClient.from("orders").update({
        status: "paid",
        shipping_address: session.shipping_details?.address || null,
        customer_email: session.customer_details?.email || user.email
      }).eq("id", order.id);
      if (updateError) throw updateError;
      order.status = "paid";
    }
    return res.json({
      paymentStatus: session.payment_status,
      order: { ...order, amount: session.amount_total, currency: session.currency }
    });
  } catch (error) {
    console.error("Could not verify Stripe Checkout session.", error);
    return res.status(502).json({
      error: "No pudimos verificar el pago con Stripe. Conservamos tu carrito; intenta de nuevo más tarde."
    });
  }
});

app.post("/api/stripe-webhook", express.raw({ type: "application/json", limit: "1mb" }), async (req, res) => {
  if (!stripe || !stripeWebhookSecret || !adminClient) {
    return res.status(503).send("Stripe webhook is not configured.");
  }
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.get("stripe-signature"), stripeWebhookSecret);
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
      console.error("Could not update Stripe order from webhook.", error);
      return res.status(500).send("Could not update order.");
    }
  } else if (event.type === "checkout.session.async_payment_failed") {
    const { error } = await adminClient.from("orders").update({ status: "failed" })
      .eq("stripe_checkout_session_id", session.id);
    if (error) {
      console.error("Could not mark failed Stripe order from webhook.", error);
      return res.status(500).send("Could not update order.");
    }
  } else if (event.type === "checkout.session.expired") {
    const { error } = await adminClient.from("orders").update({ status: "cancelled" })
      .eq("stripe_checkout_session_id", session.id);
    if (error) {
      console.error("Could not cancel expired Stripe order from webhook.", error);
      return res.status(500).send("Could not update order.");
    }
  }
  return res.json({ received: true });
});

app.use(express.json({ limit: "16kb" }));

app.post("/api/paypal-webhook", async (req, res) => {
  if (!paypalWebhookId || !paypalClientId || !paypalClientSecret || !adminClient) {
    return res.status(503).json({ error: "PayPal webhook is not configured." });
  }
  try {
    const accessToken = await getPayPalAccessToken();
    const verification = await fetch(`${paypalBaseUrl}/v1/notifications/verify-webhook-signature`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        auth_algo: req.get("paypal-auth-algo"),
        cert_url: req.get("paypal-cert-url"),
        transmission_id: req.get("paypal-transmission-id"),
        transmission_sig: req.get("paypal-transmission-sig"),
        transmission_time: req.get("paypal-transmission-time"),
        webhook_id: paypalWebhookId,
        webhook_event: req.body
      }),
      signal: AbortSignal.timeout(15000)
    });
    const verificationResult = await verification.json();
    if (!verification.ok || verificationResult.verification_status !== "SUCCESS") {
      console.error("PayPal webhook signature verification failed.", verificationResult);
      return res.status(400).json({ error: "Invalid PayPal webhook signature." });
    }

    const event = req.body;
    if (event.event_type === "PAYMENT.CAPTURE.COMPLETED") {
      const paypalOrderId = event.resource?.supplementary_data?.related_ids?.order_id;
      if (paypalOrderId) {
        const { data: order, error } = await adminClient.from("orders")
          .select("id,user_id,paypal_order_id,amount,currency,status,customer_email")
          .eq("paypal_order_id", paypalOrderId)
          .eq("payment_provider", "paypal")
          .maybeSingle();
        if (error) throw error;
        if (order && order.status !== "paid") {
          const capture = await paypalRequest(`/v2/checkout/orders/${encodeURIComponent(paypalOrderId)}`);
          await savePaidPayPalOrder(order, capture);
        }
      }
    }
    return res.json({ received: true });
  } catch (error) {
    console.error("Could not process PayPal webhook.", error);
    return res.status(500).json({ error: "Could not process PayPal webhook." });
  }
});

app.use((_req, res) => {
  res.status(404).json({ error: "Endpoint no encontrado." });
});

app.listen(port, "0.0.0.0", () => {
  console.log(`CAPSTREET payment API listening on port ${port}.`);
});
