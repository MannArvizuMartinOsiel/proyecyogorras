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
  perfume: "Perfumes",
  chain: "Joyería",
  bracelet: "Joyería",
  sneaker: "Tenis"
};
const CATEGORY_DEPARTMENTS = new Set(["Gorras", "Ropa", "Perfumes", "Joyería", "Tenis"]);
const PRODUCT_IMAGE_BUCKET = "product-images";
const MAX_PRODUCT_IMAGE_BYTES = 4 * 1024 * 1024;
const HERO_VIDEO_BUCKET = "hero-videos";
const MAX_HERO_VIDEO_BYTES = 20 * 1024 * 1024;
const HERO_VIDEO_TYPES = new Map([
  ["video/mp4", {
    extension: "mp4",
    signature: bytes => bytes.length >= 12 && bytes.toString("ascii", 4, 8) === "ftyp"
  }],
  ["video/webm", {
    extension: "webm",
    signature: bytes => bytes.length >= 4 &&
      bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
  }]
]);
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
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
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
  const template = products.find(product => product.type === row.type) || products[0];
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

function catalogMigrationError(message) {
  const error = new Error(message);
  error.code = "CATALOG_MIGRATION_REQUIRED";
  return error;
}

function isCatalogSchemaError(error) {
  return ["42P01", "PGRST204", "PGRST205"].includes(error?.code) ||
    /admin_product_overrides|admin_products|image_url|schema cache/i.test(error?.message || "");
}

async function getProductCatalog() {
  if (!adminClient) return products;
  if (serviceRoleKeyRejected) {
    const error = new Error("Supabase rechazó SUPABASE_SERVICE_ROLE_KEY. Verifica la clave en Render.");
    error.code = "SUPABASE_SERVICE_ROLE_KEY_REJECTED";
    throw error;
  }
  const { data: catalogRows, error: catalogError } = await adminClient
    .from("admin_products")
    .select("id,department,category,type,name,description,price,color,brim,patch,label,image_url,is_deleted")
    .order("id", { ascending: true });
  if (catalogError) {
    if (/invalid api key/i.test(`${catalogError.message || ""} ${catalogError.hint || ""}`)) {
      serviceRoleKeyRejected = true;
      console.error("Supabase rechazó SUPABASE_SERVICE_ROLE_KEY. Verifica que sea la clave secreta del proyecto CAPSTREET en Render.");
      const configurationError = new Error("Supabase rechazó SUPABASE_SERVICE_ROLE_KEY. Verifica la clave en Render.");
      configurationError.code = "SUPABASE_SERVICE_ROLE_KEY_REJECTED";
      throw configurationError;
    }
    if (isCatalogSchemaError(catalogError)) {
      throw catalogMigrationError("Falta actualizar el esquema del catálogo en Supabase. Ejecuta el archivo supabase-schema.sql y vuelve a desplegar.");
    }
    throw catalogError;
  }
  const rowsById = new Map(catalogRows.map(row => [Number(row.id), row]));
  const baseCatalog = products.flatMap(product => {
    const override = rowsById.get(product.id);
    if (override?.is_deleted) return [];
    const optionTemplate = products.find(item => item.type === (override?.type || product.type)) || product;
    return [{
      ...product,
      ...(override || {}),
      id: product.id,
      image_url: override?.image_url ?? product.image_url ?? null,
      colorOptions: optionTemplate.colorOptions,
      sizeOptions: optionTemplate.sizeOptions
    }];
  });
  const customCatalog = catalogRows
    .filter(row => Number(row.id) >= 1000 && !row.is_deleted)
    .map(formatAdminProduct);
  return [...baseCatalog, ...customCatalog];
}

function validateAdminProduct(body) {
  const { name, description, price, type, category } = body || {};
  const department = PRODUCT_TYPES[type];
  if (
    typeof name !== "string" || !name.trim() || name.trim().length > 80 ||
    typeof description !== "string" || !description.trim() || description.trim().length > 300 ||
    !department || !Number.isSafeInteger(price) || price < 1 || price > 1000000 ||
    (category !== undefined && category !== null &&
      (typeof category !== "string" || category.trim().length > 40))
  ) {
    return { error: "Revisa nombre, departamento, tipo, categoría y precio del artículo." };
  }
  const template = products.find(product => product.type === type) || products[0];
  return {
    product: {
      department,
      category: typeof category === "string" ? category.trim() || null : null,
      type,
      name: name.trim(),
      description: description.trim(),
      price,
      color: template.color,
      brim: template.brim,
      patch: template.patch || null,
      label: template.label
    }
  };
}

function requestError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function uploadProductImage(imageData) {
  if (typeof imageData !== "string") {
    throw requestError("La imagen del producto no es válida.");
  }
  const match = imageData.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match) throw requestError("Usa una imagen JPG, PNG o WebP válida.");
  const [, contentType, encodedImage] = match;
  const imageBuffer = Buffer.from(encodedImage, "base64");
  const imageType = PRODUCT_IMAGE_TYPES.get(contentType);
  if (
    imageBuffer.length === 0 ||
    imageBuffer.length > MAX_PRODUCT_IMAGE_BYTES ||
    !imageType.signature(imageBuffer)
  ) {
    throw requestError("La imagen está vacía, supera 4 MB o su contenido no coincide con el formato.");
  }

  const path = `${crypto.randomUUID()}.${imageType.extension}`;
  const { error } = await adminClient.storage.from(PRODUCT_IMAGE_BUCKET).upload(path, imageBuffer, {
    contentType,
    cacheControl: "31536000",
    upsert: false
  });
  if (error) {
    console.error("Could not upload admin product image.", {
      bucket: PRODUCT_IMAGE_BUCKET,
      statusCode: error.statusCode || error.status,
      error: error.error,
      message: error.message
    });
    const storageError = `${error.error || ""} ${error.message || ""}`.toLowerCase();
    const statusCode = Number(error.statusCode || error.status);
    if (statusCode === 404 || storageError.includes("bucket not found")) {
      throw requestError(
        "No existe el bucket product-images en Supabase. Ejecuta el archivo supabase-schema.sql en el SQL Editor del proyecto correcto.",
        503
      );
    }
    if (statusCode === 401 || statusCode === 403) {
      throw requestError(
        "Supabase rechazó la subida. Verifica que SUPABASE_SERVICE_ROLE_KEY en Render sea la clave secreta del mismo proyecto y vuelve a desplegar.",
        503
      );
    }
    if (statusCode === 413) {
      throw requestError("La imagen supera el límite permitido por el bucket product-images.", 413);
    }
    throw requestError(
      `No se pudo subir la imagen a Supabase${Number.isFinite(statusCode) ? ` (HTTP ${statusCode})` : ""}. Revisa los logs del servicio capstreet-backend en Render.`,
      503
    );
  }
  return {
    path,
    url: adminClient.storage.from(PRODUCT_IMAGE_BUCKET).getPublicUrl(path).data.publicUrl
  };
}

async function removeProductImage(imageUrl) {
  if (!adminClient || typeof imageUrl !== "string") return;
  const publicPrefix = `${supabaseUrl}/storage/v1/object/public/${PRODUCT_IMAGE_BUCKET}/`;
  if (!imageUrl.startsWith(publicPrefix)) return;
  let path;
  try {
    path = decodeURIComponent(new URL(imageUrl).pathname.slice(
      new URL(publicPrefix).pathname.length
    ));
  } catch {
    return;
  }
  if (!path || path.includes("..")) return;
  const { error } = await adminClient.storage.from(PRODUCT_IMAGE_BUCKET).remove([path]);
  if (error) console.error("Could not remove product image from Supabase Storage.", error);
}

async function getHeroVideo() {
  if (!adminClient) return null;
  const { data, error } = await adminClient.from("site_media")
    .select("video_url,video_path")
    .eq("id", "hero")
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function getCategoryImageCatalog() {
  if (!adminClient) return {};
  const { data, error } = await adminClient
    .from("admin_category_images")
    .select("department,image_url");
  if (error) throw error;
  return Object.fromEntries(data.map(row => [row.department, row.image_url]));
}

async function getFeaturedProductCatalog() {
  if (!adminClient) return [];
  const { data, error } = await adminClient
    .from("admin_featured_products")
    .select("product_id,display_order,image_url")
    .order("display_order", { ascending: true });
  if (error) throw error;
  return data;
}

async function uploadHeroVideo(videoBuffer, contentType) {
  const videoType = HERO_VIDEO_TYPES.get(contentType);
  if (
    !Buffer.isBuffer(videoBuffer) ||
    videoBuffer.length === 0 ||
    videoBuffer.length > MAX_HERO_VIDEO_BYTES ||
    !videoType ||
    !videoType.signature(videoBuffer)
  ) {
    throw requestError("El video debe ser MP4 o WebM válido y no superar 20 MB.");
  }

  const path = `homepage/${crypto.randomUUID()}.${videoType.extension}`;
  const { error } = await adminClient.storage.from(HERO_VIDEO_BUCKET).upload(path, videoBuffer, {
    contentType,
    cacheControl: "31536000",
    upsert: false
  });
  if (error) {
    console.error("Could not upload homepage hero video.", {
      bucket: HERO_VIDEO_BUCKET,
      statusCode: error.statusCode || error.status,
      message: error.message
    });
    const statusCode = Number(error.statusCode || error.status);
    if (statusCode === 404 || /bucket not found/i.test(error.message || "")) {
      throw requestError("No existe el bucket hero-videos. Ejecuta supabase-schema.sql en Supabase.", 503);
    }
    if (statusCode === 413) {
      throw requestError("El video supera el límite permitido por el bucket hero-videos.", 413);
    }
    throw requestError("No se pudo subir el video a Supabase Storage. Revisa la configuración y los registros de Render.", 503);
  }
  return {
    path,
    url: adminClient.storage.from(HERO_VIDEO_BUCKET).getPublicUrl(path).data.publicUrl
  };
}

async function removeHeroVideoFile(path) {
  if (!adminClient || typeof path !== "string" || !path.startsWith("homepage/") || path.includes("..")) return;
  const { error } = await adminClient.storage.from(HERO_VIDEO_BUCKET).remove([path]);
  if (error) throw error;
}

function catalogRow(product, isDeleted = false) {
  return {
    id: product.id,
    department: product.department,
    category: product.category || null,
    type: product.type,
    name: product.name,
    description: product.description,
    price: product.price,
    color: product.color,
    brim: product.brim,
    patch: product.patch || null,
    label: product.label,
    image_url: product.image_url || null,
    is_deleted: isDeleted
  };
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

app.get("/api/hero-video", async (_req, res) => {
  try {
    const media = await getHeroVideo();
    return res.json({ videoUrl: media?.video_url || null });
  } catch (error) {
    console.error("Could not load homepage hero video.", error);
    return res.status(503).json({
      error: "No se pudo cargar el video de portada. Verifica que supabase-schema.sql esté actualizado."
    });
  }
});

app.put(
  "/api/admin/hero-video",
  express.raw({ type: ["video/mp4", "video/webm"], limit: MAX_HERO_VIDEO_BYTES }),
  async (req, res) => {
    let uploadedVideoPath = null;
    try {
      if (!await getAdminUser(req, res)) return;
      const currentMedia = await getHeroVideo();
      const contentType = (req.get("content-type") || "").split(";")[0].toLowerCase();
      const uploaded = await uploadHeroVideo(req.body, contentType);
      uploadedVideoPath = uploaded.path;
      const { error } = await adminClient.from("site_media").upsert({
        id: "hero",
        video_url: uploaded.url,
        video_path: uploaded.path,
        updated_at: new Date().toISOString()
      });
      if (error) throw error;

      uploadedVideoPath = null;
      let warning;
      if (currentMedia?.video_path) {
        try {
          await removeHeroVideoFile(currentMedia.video_path);
        } catch (error) {
          console.error("Could not remove replaced homepage hero video.", error);
          warning = "El nuevo video se guardó, pero no se pudo borrar el archivo anterior.";
        }
      }
      return res.json({ videoUrl: uploaded.url, ...(warning ? { warning } : {}) });
    } catch (error) {
      console.error("Could not save homepage hero video.", error);
      if (uploadedVideoPath && adminClient) {
        try {
          await removeHeroVideoFile(uploadedVideoPath);
        } catch (cleanupError) {
          console.error("Could not remove orphaned homepage hero video.", cleanupError);
        }
      }
      if (error.code === "42P01" || error.code === "PGRST205" || /site_media/i.test(error.message || "")) {
        return res.status(503).json({
          error: "Falta actualizar Supabase. Ejecuta el archivo supabase-schema.sql y vuelve a intentar."
        });
      }
      return res.status(error.status || 503).json({
        error: error.message || "No pudimos guardar el video de portada."
      });
    }
  }
);

app.delete("/api/admin/hero-video", async (req, res) => {
  try {
    if (!await getAdminUser(req, res)) return;
    const currentMedia = await getHeroVideo();
    if (!currentMedia) return res.json({ videoUrl: null });
    const { error } = await adminClient.from("site_media").delete().eq("id", "hero");
    if (error) throw error;

    let warning;
    if (currentMedia.video_path) {
      try {
        await removeHeroVideoFile(currentMedia.video_path);
      } catch (error) {
        console.error("Could not remove deleted homepage hero video.", error);
        warning = "El video se quitó de la portada, pero no se pudo borrar su archivo anterior.";
      }
    }
    return res.json({ videoUrl: null, ...(warning ? { warning } : {}) });
  } catch (error) {
    console.error("Could not remove homepage hero video.", error);
    if (error.code === "42P01" || error.code === "PGRST205" || /site_media/i.test(error.message || "")) {
      return res.status(503).json({
        error: "Falta actualizar Supabase. Ejecuta el archivo supabase-schema.sql y vuelve a intentar."
      });
    }
    return res.status(error.status || 503).json({
      error: error.message || "No pudimos quitar el video de portada."
    });
  }
});

app.get("/api/products", async (_req, res) => {
  try {
    const catalog = await getProductCatalog();
    return res.json({ products: catalog, ...(!adminClient ? { source: "bundled" } : {}) });
  } catch (error) {
    console.error("Could not load product catalog.", error);
    return res.json({ products, source: "bundled" });
  }
});

app.get("/api/category-images", async (_req, res) => {
  try {
    return res.json({ images: await getCategoryImageCatalog() });
  } catch (error) {
    console.error("Could not load catalog category images.", error);
    return res.status(503).json({
      error: "No se pudieron cargar las imágenes de categorías. Verifica que supabase-schema.sql esté actualizado."
    });
  }
});

app.get("/api/admin/category-images", async (req, res) => {
  try {
    if (!await getAdminUser(req, res)) return;
    return res.json({ images: await getCategoryImageCatalog() });
  } catch (error) {
    console.error("Could not load admin category images.", error);
    return res.status(503).json({
      error: "No se pudieron cargar las imágenes de categorías. Ejecuta supabase-schema.sql y vuelve a intentar."
    });
  }
});

app.put("/api/admin/category-images/:department", express.json({ limit: "6mb" }), async (req, res) => {
  let uploadedImagePath = null;
  try {
    if (!await getAdminUser(req, res)) return;
    const department = req.params.department;
    if (!CATEGORY_DEPARTMENTS.has(department)) {
      return res.status(400).json({ error: "La categoría indicada no es válida." });
    }
    if (typeof req.body?.imageData !== "string") {
      return res.status(400).json({ error: "Selecciona una imagen válida para la categoría." });
    }
    const { data: current, error: currentError } = await adminClient
      .from("admin_category_images")
      .select("image_url,image_path")
      .eq("department", department)
      .maybeSingle();
    if (currentError) throw currentError;

    const uploaded = await uploadProductImage(req.body.imageData);
    uploadedImagePath = uploaded.path;
    const { error } = await adminClient.from("admin_category_images").upsert({
      department,
      image_url: uploaded.url,
      image_path: uploaded.path,
      updated_at: new Date().toISOString()
    });
    if (error) throw error;
    uploadedImagePath = null;
    if (current?.image_url && current.image_url !== uploaded.url) {
      await removeProductImage(current.image_url);
    }
    return res.json({ department, imageUrl: uploaded.url });
  } catch (error) {
    console.error("Could not save catalog category image.", error);
    if (uploadedImagePath && adminClient) {
      const { error: cleanupError } = await adminClient.storage
        .from(PRODUCT_IMAGE_BUCKET)
        .remove([uploadedImagePath]);
      if (cleanupError) console.error("Could not remove orphaned category image.", cleanupError);
    }
    if (["42P01", "PGRST204", "PGRST205"].includes(error.code) || /admin_category_images/i.test(error.message || "")) {
      return res.status(503).json({
        error: "Falta actualizar Supabase. Ejecuta el archivo supabase-schema.sql y vuelve a intentar."
      });
    }
    return res.status(error.status || 503).json({
      error: error.message || "No pudimos guardar la imagen de categoría."
    });
  }
});

app.delete("/api/admin/category-images/:department", async (req, res) => {
  try {
    if (!await getAdminUser(req, res)) return;
    const department = req.params.department;
    if (!CATEGORY_DEPARTMENTS.has(department)) {
      return res.status(400).json({ error: "La categoría indicada no es válida." });
    }
    const { data: current, error: currentError } = await adminClient
      .from("admin_category_images")
      .select("image_url")
      .eq("department", department)
      .maybeSingle();
    if (currentError) throw currentError;
    if (!current) return res.json({ department, imageUrl: null });
    const { error } = await adminClient
      .from("admin_category_images")
      .delete()
      .eq("department", department);
    if (error) throw error;
    await removeProductImage(current.image_url);
    return res.json({ department, imageUrl: null });
  } catch (error) {
    console.error("Could not remove catalog category image.", error);
    if (["42P01", "PGRST204", "PGRST205"].includes(error.code) || /admin_category_images/i.test(error.message || "")) {
      return res.status(503).json({
        error: "Falta actualizar Supabase. Ejecuta el archivo supabase-schema.sql y vuelve a intentar."
      });
    }
    return res.status(error.status || 503).json({
      error: error.message || "No pudimos quitar la imagen de categoría."
    });
  }
});

app.get("/api/featured-products", async (_req, res) => {
  try {
    return res.json({ products: await getFeaturedProductCatalog() });
  } catch (error) {
    console.error("Could not load featured products.", error);
    return res.status(503).json({
      error: "No se pudieron cargar los productos destacados. Verifica que supabase-schema.sql esté actualizado."
    });
  }
});

app.get("/api/admin/featured-products", async (req, res) => {
  try {
    if (!await getAdminUser(req, res)) return;
    return res.json({
      products: await getFeaturedProductCatalog(),
      catalog: await getProductCatalog()
    });
  } catch (error) {
    console.error("Could not load admin featured products.", error);
    return res.status(503).json({
      error: "No se pudieron cargar los productos destacados. Ejecuta supabase-schema.sql y vuelve a intentar."
    });
  }
});

app.put("/api/admin/featured-products/:id", express.json({ limit: "6mb" }), async (req, res) => {
  let uploadedImagePath = null;
  try {
    if (!await getAdminUser(req, res)) return;
    const productId = Number(req.params.id);
    if (!Number.isSafeInteger(productId) || productId < 1) {
      return res.status(400).json({ error: "El producto seleccionado no es válido." });
    }
    if (typeof req.body?.removeImage !== "undefined" && typeof req.body.removeImage !== "boolean") {
      return res.status(400).json({ error: "La opción para quitar la imagen no es válida." });
    }
    const catalog = await getProductCatalog();
    const product = catalog.find(item => item.id === productId);
    if (!product) return res.status(404).json({ error: "No encontramos ese producto en el catálogo." });
    const { data: current, error: currentError } = await adminClient
      .from("admin_featured_products")
      .select("product_id,display_order,image_url,image_path")
      .eq("product_id", productId)
      .maybeSingle();
    if (currentError) throw currentError;

    let imageUrl = current?.image_url || null;
    let imagePath = current?.image_path || null;
    if (req.body.imageData) {
      const upload = await uploadProductImage(req.body.imageData);
      uploadedImagePath = upload.path;
      imageUrl = upload.url;
      imagePath = upload.path;
    } else if (req.body?.removeImage === true) {
      imageUrl = null;
      imagePath = null;
    }
    let displayOrder = current?.display_order;
    if (!current) {
      const featured = await getFeaturedProductCatalog();
      displayOrder = featured.reduce((max, entry) => Math.max(max, entry.display_order), 0) + 1;
    }
    const { error } = await adminClient.from("admin_featured_products").upsert({
      product_id: productId,
      display_order: displayOrder,
      image_url: imageUrl,
      image_path: imagePath,
      updated_at: new Date().toISOString()
    });
    if (error) throw error;
    uploadedImagePath = null;
    if (current?.image_url && current.image_url !== imageUrl) {
      await removeProductImage(current.image_url);
    }
    return res.json({
      product_id: productId,
      display_order: displayOrder,
      image_url: imageUrl,
      product
    });
  } catch (error) {
    console.error("Could not save featured product.", error);
    if (uploadedImagePath && adminClient) {
      const { error: cleanupError } = await adminClient.storage
        .from(PRODUCT_IMAGE_BUCKET)
        .remove([uploadedImagePath]);
      if (cleanupError) console.error("Could not remove orphaned featured product image.", cleanupError);
    }
    if (["42P01", "PGRST204", "PGRST205"].includes(error.code) || /admin_featured_products/i.test(error.message || "")) {
      return res.status(503).json({
        error: "Falta actualizar Supabase. Ejecuta el archivo supabase-schema.sql y vuelve a intentar."
      });
    }
    return res.status(error.status || 503).json({
      error: error.message || "No pudimos guardar el producto destacado."
    });
  }
});

app.delete("/api/admin/featured-products/:id", async (req, res) => {
  try {
    if (!await getAdminUser(req, res)) return;
    const productId = Number(req.params.id);
    if (!Number.isSafeInteger(productId) || productId < 1) {
      return res.status(400).json({ error: "El producto seleccionado no es válido." });
    }
    const { data: current, error: currentError } = await adminClient
      .from("admin_featured_products")
      .select("image_url")
      .eq("product_id", productId)
      .maybeSingle();
    if (currentError) throw currentError;
    if (!current) return res.json({ product_id: productId });
    const { error } = await adminClient
      .from("admin_featured_products")
      .delete()
      .eq("product_id", productId);
    if (error) throw error;
    if (current.image_url) await removeProductImage(current.image_url);
    return res.json({ product_id: productId });
  } catch (error) {
    console.error("Could not remove featured product.", error);
    if (["42P01", "PGRST204", "PGRST205"].includes(error.code) || /admin_featured_products/i.test(error.message || "")) {
      return res.status(503).json({
        error: "Falta actualizar Supabase. Ejecuta el archivo supabase-schema.sql y vuelve a intentar."
      });
    }
    return res.status(error.status || 503).json({
      error: error.message || "No pudimos quitar el producto destacado."
    });
  }
});

app.get("/api/admin/products", async (req, res) => {
  try {
    if (!await getAdminUser(req, res)) return;
    return res.json({ products: await getProductCatalog() });
  } catch (error) {
    if (error.code !== "SUPABASE_SERVICE_ROLE_KEY_REJECTED") {
      console.error("Could not load admin product catalog.", error);
    }
    const cause = error.code === "SUPABASE_SERVICE_ROLE_KEY_REJECTED"
      ? "Supabase rechazó SUPABASE_SERVICE_ROLE_KEY. Configura la clave secreta del mismo proyecto en Render."
      : error.code === "CATALOG_MIGRATION_REQUIRED"
        ? error.message
        : "Revisa los registros del servicio capstreet-backend y las credenciales de Supabase.";
    return res.json({
      products,
      source: "bundled",
      warning: `${cause} Se muestran los productos originales en solo lectura. Para agregar, editar o quitar productos, corrige la conexión y vuelve a cargar el panel.`
    });
  }
});

app.post("/api/admin/products", express.json({ limit: "6mb" }), async (req, res) => {
  let uploadedImagePath = null;
  let imageWarning = null;
  try {
    if (!await getAdminUser(req, res)) return;
    const validated = validateAdminProduct(req.body);
    if (validated.error) return res.status(400).json({ error: validated.error });
    let imageUrl = null;
    if (req.body.imageData) {
      try {
        const upload = await uploadProductImage(req.body.imageData);
        uploadedImagePath = upload.path;
        imageUrl = upload.url;
      } catch (error) {
        if (error.status !== 503) throw error;
        imageWarning = error.message;
      }
    }
    const { data, error } = await adminClient.from("admin_products").insert({
      ...validated.product,
      image_url: imageUrl
    }).select("id,department,category,type,name,description,price,color,brim,patch,label,image_url").single();
    if (error) throw error;
    uploadedImagePath = null;
    return res.status(201).json({
      product: formatAdminProduct(data),
      ...(imageWarning ? { warning: `El artículo se guardó, pero no se pudo subir la imagen: ${imageWarning}` } : {})
    });
  } catch (error) {
    console.error("Could not create admin product.", error);
    if (uploadedImagePath && adminClient) {
      const { error: cleanupError } = await adminClient.storage
        .from(PRODUCT_IMAGE_BUCKET)
        .remove([uploadedImagePath]);
      if (cleanupError) console.error("Could not remove orphaned admin product image.", cleanupError);
    }
    if (isCatalogSchemaError(error)) {
      return res.status(503).json({
        error: "Falta actualizar el catálogo en Supabase. Ejecuta supabase-schema.sql y vuelve a intentar."
      });
    }
    return res.status(error.status || 503).json({
      error: error.code === "CATALOG_MIGRATION_REQUIRED"
        ? error.message
        : error.message || "No pudimos guardar el artículo. Intenta de nuevo."
    });
  }
});

app.put("/api/admin/products/:id", express.json({ limit: "6mb" }), async (req, res) => {
  let uploadedImagePath = null;
  let imageWarning = null;
  try {
    if (!await getAdminUser(req, res)) return;
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: "El artículo indicado no es válido." });
    const current = (await getProductCatalog()).find(product => product.id === id);
    if (!current) return res.status(404).json({ error: "No encontramos ese artículo en el catálogo." });
    const validated = validateAdminProduct(req.body);
    if (validated.error) return res.status(400).json({ error: validated.error });
    if (typeof req.body.removeImage !== "boolean" && req.body.removeImage !== undefined) {
      return res.status(400).json({ error: "La opción para quitar la imagen no es válida." });
    }

    let imageUrl = current.image_url || null;
    if (req.body.imageData) {
      try {
        const upload = await uploadProductImage(req.body.imageData);
        uploadedImagePath = upload.path;
        imageUrl = upload.url;
      } catch (error) {
        if (error.status !== 503) throw error;
        imageWarning = error.message;
      }
    } else if (req.body.removeImage === true) {
      imageUrl = null;
    }
    const updatedProduct = {
      ...current,
      ...validated.product,
      id,
      image_url: imageUrl
    };
    const isBuiltIn = products.some(product => product.id === id);
    const { error } = isBuiltIn
      ? await adminClient.from("admin_products").upsert(catalogRow(updatedProduct), { onConflict: "id" })
      : await adminClient.from("admin_products").update({
        ...validated.product,
        image_url: imageUrl
      }).eq("id", id).select("id").single();
    if (error) throw error;

    uploadedImagePath = null;
    if (current.image_url && current.image_url !== imageUrl) await removeProductImage(current.image_url);
    return res.json({
      product: updatedProduct,
      ...(imageWarning ? { warning: `Los cambios se guardaron, pero no se pudo subir la nueva imagen: ${imageWarning}` } : {})
    });
  } catch (error) {
    console.error("Could not update admin product.", error);
    if (uploadedImagePath && adminClient) {
      const { error: cleanupError } = await adminClient.storage.from(PRODUCT_IMAGE_BUCKET).remove([uploadedImagePath]);
      if (cleanupError) console.error("Could not remove orphaned admin product image.", cleanupError);
    }
    if (isCatalogSchemaError(error)) {
      return res.status(503).json({
        error: "Falta actualizar el catálogo en Supabase. Ejecuta supabase-schema.sql y vuelve a intentar."
      });
    }
    return res.status(error.status || 503).json({
      error: error.code === "CATALOG_MIGRATION_REQUIRED"
        ? error.message
        : error.message || "No pudimos actualizar el artículo. Intenta de nuevo."
    });
  }
});

app.delete("/api/admin/products/:id", async (req, res) => {
  try {
    if (!await getAdminUser(req, res)) return;
    const id = Number(req.params.id);
    if (!Number.isSafeInteger(id) || id < 1) return res.status(400).json({ error: "El artículo indicado no es válido." });
    const current = (await getProductCatalog()).find(product => product.id === id);
    if (!current) return res.status(404).json({ error: "No encontramos ese artículo en el catálogo." });

    const result = products.some(product => product.id === id)
      ? await adminClient.from("admin_products").upsert(catalogRow(current, true), { onConflict: "id" })
      : await adminClient.from("admin_products").delete().eq("id", id);
    if (result.error) throw result.error;
    await removeProductImage(current.image_url);
    return res.status(204).end();
  } catch (error) {
    console.error("Could not delete admin product.", error);
    if (isCatalogSchemaError(error)) {
      return res.status(503).json({
        error: "Falta actualizar el catálogo en Supabase. Ejecuta supabase-schema.sql y vuelve a intentar."
      });
    }
    return res.status(error.status || 503).json({
      error: error.code === "CATALOG_MIGRATION_REQUIRED"
        ? error.message
        : error.message || "No pudimos quitar el artículo. Intenta de nuevo."
    });
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

app.use((error, _req, res, next) => {
  if (error.type === "entity.too.large") {
    return res.status(413).json({ error: "El archivo supera el límite permitido de 20 MB." });
  }
  return next(error);
});

app.use((_req, res) => {
  res.status(404).json({ error: "Endpoint no encontrado." });
});

app.listen(port, "0.0.0.0", () => {
  console.log(`CAPSTREET payment API listening on port ${port}.`);
});
