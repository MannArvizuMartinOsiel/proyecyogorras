const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const net = require("node:net");
const path = require("node:path");
const test = require("node:test");

async function getFreePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

test("the API remains available and disables checkout when payment credentials are missing", async t => {
  const port = await getFreePort();
  const env = {
    ...process.env,
    PORT: String(port),
    SITE_ORIGIN: "http://localhost:5500",
    PAYPAL_MODE: "sandbox",
    DOTENV_CONFIG_PATH: path.join(__dirname, "__no-test-env__.env"),
    DOTENV_CONFIG_QUIET: "true"
  };
  for (const key of [
    "STRIPE_PUBLISHABLE_KEY",
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "PAYPAL_CLIENT_ID",
    "PAYPAL_CLIENT_SECRET",
    "PAYPAL_WEBHOOK_ID",
    "SUPABASE_SERVICE_ROLE_KEY"
  ]) delete env[key];

  const server = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
    env,
    stdio: "ignore"
  });
  t.after(() => server.kill());

  let health;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      health = await fetch(`http://127.0.0.1:${port}/health`);
      break;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  assert.ok(health, "the API should start without payment-provider credentials");
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), {
    status: "ok",
    payments: { stripe: false, paypal: false }
  });

  const options = await fetch(`http://127.0.0.1:${port}/api/payment-options`);
  assert.deepEqual(await options.json(), {
    stripe: false,
    paypal: false,
    methods: {
      cards: false,
      spei: false,
      oxxo: false,
      applePay: false,
      googlePay: false
    },
    stripePublishableKey: null
  });

  const validPromo = await fetch(`http://127.0.0.1:${port}/api/validate-promo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code: "cap10",
      items: [{ id: 1, quantity: 1, color: "black", size: "Unitalla" }]
    })
  });
  assert.equal(validPromo.status, 200);
  assert.deepEqual(await validPromo.json(), {
    code: "CAP10",
    percentOff: 10,
    subtotal: 54900,
    discountAmount: 5490,
    amount: 49410,
    currency: "mxn"
  });

  const secondPromo = await fetch(`http://127.0.0.1:${port}/api/validate-promo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code: "STREET15",
      items: [{ id: 1, quantity: 1, color: "black", size: "Unitalla" }]
    })
  });
  assert.equal(secondPromo.status, 200);
  assert.equal((await secondPromo.json()).amount, 46665);

  const invalidVariant = await fetch(`http://127.0.0.1:${port}/api/validate-promo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code: "CAP10",
      items: [{ id: 1, quantity: 1, color: "purple", size: "Unitalla" }]
    })
  });
  assert.equal(invalidVariant.status, 400);

  const invalidPromo = await fetch(`http://127.0.0.1:${port}/api/validate-promo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      code: "NOTREAL",
      items: [{ id: 1, quantity: 1, color: "black", size: "Unitalla" }]
    })
  });
  assert.equal(invalidPromo.status, 400);

  const unavailableCheckout = await fetch(`http://127.0.0.1:${port}/api/paypal/create-order`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items: [{ id: 1, quantity: 1 }] })
  });
  assert.equal(unavailableCheckout.status, 503);
  assert.match((await unavailableCheckout.json()).error, /no está configurado|todavía no está configurado/i);

  const unavailableStripeCheckout = await fetch(`http://127.0.0.1:${port}/api/create-checkout-session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ items: [{ id: 1, quantity: 1 }] })
  });
  assert.equal(unavailableStripeCheckout.status, 503);
});
