// Offline tests for the Netlify functions. Stripe, fal.ai and Netlify Blobs are
// replaced with in-memory fakes, so no keys or network are needed.
// Run with: npm install && npm test
import { test, mock } from "node:test";
import assert from "node:assert/strict";

// ---- in-memory Blobs
const stores = {};
const getStore = name => {
  const m = (stores[name] ||= new Map());
  return {
    async get(k, o) { if (!m.has(k)) return null; const v = m.get(k); return o?.type === "json" ? JSON.parse(v) : v; },
    async set(k, v) { m.set(k, v); }, async setJSON(k, v) { m.set(k, JSON.stringify(v)); }
  };
};
let connected = 0;
mock.module("@netlify/blobs", { namedExports: { getStore, connectLambda: () => { connected++; } } });

// ---- fake Stripe
const db = { subs: {}, custs: {}, sessions: {} };
class FakeStripe {
  constructor() {
    this.webhooks = { constructEvent: (raw, sig) => { if (sig !== "good") throw new Error("bad sig"); return JSON.parse(raw); } };
    this.subscriptions = { retrieve: async id => structuredClone(db.subs[id]) };
    this.customers = { retrieve: async id => structuredClone(db.custs[id]) };
    this.checkout = { sessions: {
      retrieve: async (id, o) => { const s = structuredClone(db.sessions[id]); if (o?.expand?.includes("subscription")) s.subscription = structuredClone(db.subs[s.subscription]); return s; },
      create: async o => ({ id: "cs_new", url: "https://stripe/x", o })
    } };
    this.billingPortal = { sessions: { create: async o => ({ url: "https://portal", o }) } };
  }
}
mock.module("stripe", { defaultExport: FakeStripe });

// ---- fake fal
let falCalls = 0, falDelay = 0;
const fal = { config() {}, queue: { cancel: async () => {} },
  subscribe: (m, o) => new Promise((res, rej) => { falCalls++; o.onEnqueue?.("req1");
    const t = setTimeout(() => res({ data: { images: [{ url: "https://img" }] } }), falDelay);
    o.abortSignal?.addEventListener("abort", () => { clearTimeout(t); rej(new Error("aborted")); }); }) };
mock.module("@fal-ai/client", { namedExports: { fal } });
globalThis.fetch = async (u, o) => {
  if (u === "https://img") return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/webp" } });
  if (u.startsWith("https://api.resend.com")) { sent.push(JSON.parse(o.body)); return new Response("{}"); }
  throw new Error("unexpected fetch " + u);
};
const sent = [];

Object.assign(process.env, { SESSION_SECRET: "s".repeat(32), STRIPE_SECRET_KEY: "sk", STRIPE_PRICE_ID: "price_pfp",
  STRIPE_WEBHOOK_SECRET: "whsec", FAL_KEY: "fk", URL: "https://pfpforge.example", RESEND_API_KEY: "re", DAILY_AI_LIMIT: "3" });

const L = await import("../lib/auth.mjs");
const fn = n => import(`../netlify/functions/${n}.mjs`).then(m => m.handler);
const ev = (o = {}) => ({ httpMethod: "POST", headers: {}, blobs: "x", ...o });
const body = r => JSON.parse(r.body);
const hook = async (type, object) => (await fn("stripe-webhook"))(ev({ headers: { "stripe-signature": "good" }, body: JSON.stringify({ type, data: { object } }) }));
const sub = (id, cust, status, price = "price_pfp") => (db.subs[id] = { id, customer: cust, status, items: { data: [{ price: { id: price } }] } });

test("webhook: checkout activates, cancel revokes, replayed checkout stays revoked", async () => {
  db.custs.cus_1 = { id: "cus_1", email: "A@x.com " }; sub("sub_1", "cus_1", "active");
  assert.equal((await hook("checkout.session.completed", { mode: "subscription", subscription: "sub_1", customer_details: { email: "a@x.com" } })).statusCode, 200);
  assert.equal(await L.isActiveEmail("a@x.com"), true);
  db.subs.sub_1.status = "canceled";
  await hook("customer.subscription.deleted", db.subs.sub_1);
  assert.equal(await L.isActiveEmail("a@x.com"), false);
  await hook("checkout.session.completed", { mode: "subscription", subscription: "sub_1" }); // late retry
  assert.equal(await L.isActiveEmail("a@x.com"), false);
  assert.ok(connected > 0);
});

test("webhook: other products don't grant Pro", async () => {
  db.custs.cus_2 = { id: "cus_2", email: "b@x.com" }; sub("sub_2", "cus_2", "active", "price_other");
  await hook("customer.subscription.updated", db.subs.sub_2);
  assert.equal(await L.isActiveEmail("b@x.com"), false);
});

test("webhook: email change then cancel revokes old and new; deleted customer revokes", async () => {
  db.custs.cus_3 = { id: "cus_3", email: "old@x.com" }; sub("sub_3", "cus_3", "active");
  await hook("customer.subscription.updated", db.subs.sub_3);
  assert.equal(await L.isActiveEmail("old@x.com"), true);
  db.custs.cus_3.email = "new@x.com"; db.subs.sub_3.status = "canceled";
  await hook("customer.subscription.deleted", db.subs.sub_3);
  assert.equal(await L.isActiveEmail("old@x.com"), false);
  assert.equal(await L.isActiveEmail("new@x.com"), false);

  db.custs.cus_4 = { id: "cus_4", email: "d@x.com" }; sub("sub_4", "cus_4", "active");
  await hook("customer.subscription.updated", db.subs.sub_4);
  db.custs.cus_4 = { id: "cus_4", deleted: true }; db.subs.sub_4.status = "canceled";
  await hook("customer.subscription.deleted", db.subs.sub_4);
  assert.equal(await L.isActiveEmail("d@x.com"), false);
});

test("webhook: bad signature rejected; payment_failed revokes", async () => {
  const r = await (await fn("stripe-webhook"))(ev({ headers: { "stripe-signature": "bad" }, body: "{}" }));
  assert.equal(r.statusCode, 400);
  db.custs.cus_5 = { id: "cus_5", email: "e@x.com" }; sub("sub_5", "cus_5", "active");
  await hook("customer.subscription.updated", db.subs.sub_5);
  db.subs.sub_5.status = "past_due";
  await hook("invoice.payment_failed", { parent: { subscription_details: { subscription: "sub_5" } } });
  assert.equal(await L.isActiveEmail("e@x.com"), false);
});

test("auth-session: active works, old session after cancel does not, other price does not", async () => {
  const h = await fn("auth-session");
  db.custs.cus_6 = { id: "cus_6", email: "f@x.com" }; sub("sub_6", "cus_6", "active");
  db.sessions.cs_6 = { id: "cs_6", mode: "subscription", status: "complete", subscription: "sub_6", created: Date.now() / 1000 };
  let r = await h(ev({ body: JSON.stringify({ session_id: "cs_6" }) }));
  assert.equal(r.statusCode, 200); assert.equal(body(r).email, "f@x.com");
  db.subs.sub_6.status = "canceled";
  r = await h(ev({ body: JSON.stringify({ session_id: "cs_6" }) }));
  assert.equal(r.statusCode, 403);
  assert.equal(await L.isActiveEmail("f@x.com"), false);
  db.sessions.cs_old = { ...db.sessions.cs_6, created: Date.now() / 1000 - 3 * 86400 };
  db.subs.sub_6.status = "active";
  assert.equal((await h(ev({ body: JSON.stringify({ session_id: "cs_old" }) }))).statusCode, 410);
});

test("auth-request: link uses SITE/URL not Origin; same response for unknown; rate-limited", async () => {
  const h = await fn("auth-request");
  await L.setEntitlement("g@x.com", { status: "active" });
  const t0 = Date.now();
  const r = await h(ev({ headers: { origin: "https://evil.example" }, body: JSON.stringify({ email: " G@x.com" }) }));
  assert.equal(r.statusCode, 200); assert.ok(Date.now() - t0 >= 1400);
  assert.equal(sent.length, 1);
  assert.match(sent[0].html, /https:\/\/pfpforge\.example\/auth\.html#token=/);
  assert.doesNotMatch(sent[0].html, /evil/);
  const r2 = await h(ev({ body: JSON.stringify({ email: "nobody@x.com" }) }));
  assert.deepEqual(body(r2), body(r)); assert.equal(sent.length, 1);
  await h(ev({ body: JSON.stringify({ email: "g@x.com" }) }));
  await h(ev({ body: JSON.stringify({ email: "g@x.com" }) }));
  await h(ev({ body: JSON.stringify({ email: "g@x.com" }) })); // 4th in the hour
  assert.equal(sent.length, 3);
});

test("auth-verify: one-time login links; login token can't open portal or AI", async () => {
  await L.setEntitlement("h@x.com", { status: "active", customerId: "cus_h" });
  const login = L.signLogin("h@x.com");
  const auth = { authorization: "Bearer " + login };
  assert.equal((await (await fn("create-portal"))(ev({ headers: auth }))).statusCode, 401);
  assert.equal((await (await fn("transform"))(ev({ headers: auth, body: "{}" }))).statusCode, 401);
  assert.equal((await (await fn("me"))(ev({ httpMethod: "GET", headers: auth }))).body, JSON.stringify({ pro: false }));
  const v = await fn("auth-verify");
  const r = await v(ev({ body: JSON.stringify({ token: login }) }));
  assert.equal(r.statusCode, 200);
  assert.equal((await v(ev({ body: JSON.stringify({ token: login }) }))).statusCode, 401);
  const sess = { authorization: "Bearer " + body(r).token };
  const p = await (await fn("create-portal"))(ev({ headers: sess }));
  assert.equal(p.statusCode, 200);
});

test("transform: gate, validation, daily cap, timeout, kill switch", async () => {
  const h = await fn("transform");
  await L.setEntitlement("i@x.com", { status: "active" });
  const sess = { authorization: "Bearer " + L.signSession("i@x.com") };
  const img = "data:image/jpeg;base64,AAAA";
  assert.equal((await h(ev({ body: "{}" }))).statusCode, 401);
  assert.equal((await h(ev({ headers: sess, body: JSON.stringify({ prompt: "x", image: "https://evil" }) }))).statusCode, 400);
  assert.equal((await h(ev({ headers: sess, body: JSON.stringify({ prompt: "x".repeat(2000), image: img }) }))).statusCode, 400);
  const ok = await h(ev({ headers: sess, body: JSON.stringify({ prompt: "x", image: img }) }));
  assert.equal(ok.statusCode, 200); assert.match(body(ok).image, /^data:image\/webp;base64,/);
  process.env.FUNCTION_TIMEOUT_S = "5"; falDelay = 10000;
  assert.equal((await h(ev({ headers: sess, body: JSON.stringify({ prompt: "x", image: img }) }))).statusCode, 504);
  falDelay = 0; delete process.env.FUNCTION_TIMEOUT_S;
  await h(ev({ headers: sess, body: JSON.stringify({ prompt: "x", image: img }) }));
  const capped = await h(ev({ headers: sess, body: JSON.stringify({ prompt: "x", image: img }) }));
  assert.equal(capped.statusCode, 429);
  process.env.AI_ENABLED = "false";
  assert.equal((await h(ev({ headers: sess, body: "{}" }))).statusCode, 503);
  delete process.env.AI_ENABLED;
});

test("legacy pro:true session tokens still work; empty secret fails closed", async () => {
  const jwt = (await import("jsonwebtoken")).default;
  const legacy = jwt.sign({ email: "j@x.com", pro: true }, process.env.SESSION_SECRET, { expiresIn: "1d" });
  assert.equal(L.sessionEmail({ headers: { authorization: "Bearer " + legacy } }), "j@x.com");
  const s = process.env.SESSION_SECRET; process.env.SESSION_SECRET = "";
  assert.equal(L.verify(legacy), null); assert.throws(() => L.signSession("j@x.com"));
  process.env.SESSION_SECRET = s;
});
