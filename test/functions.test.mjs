// Offline tests for the Netlify functions. Stripe, fal.ai and Netlify Blobs are
// replaced with in-memory fakes, so no keys or network are needed.
// Run with: npm install && npm test
import { test, mock } from "node:test";
import assert from "node:assert/strict";

// ---- in-memory Blobs with etags + conditional writes (yields between ops,
// so parallel requests really interleave)
const tick = () => new Promise(r => setImmediate(r));
const stores = {};
const getStore = opts => {
  const name = typeof opts === "string" ? opts : opts.name;
  const m = (stores[name] ||= new Map());
  let n = 0;
  const parse = (v, o) => (o?.type === "json" ? JSON.parse(v) : v);
  return {
    async get(k, o) { await tick(); return m.has(k) ? parse(m.get(k).v, o) : null; },
    async getWithMetadata(k, o) { await tick(); return m.has(k) ? { data: parse(m.get(k).v, o), etag: m.get(k).etag, metadata: {} } : null; },
    async set(k, v, o = {}) {
      await tick();
      if (o.onlyIfNew && m.has(k)) return { modified: false };
      if (o.onlyIfMatch && m.get(k)?.etag !== o.onlyIfMatch) return { modified: false };
      const etag = `e${++n}-${Math.random()}`; m.set(k, { v, etag }); return { modified: true, etag };
    },
    async setJSON(k, v, o) { return this.set(k, JSON.stringify(v), o); }
  };
};
mock.module("@netlify/blobs", { namedExports: { getStore } });

// ---- fake Stripe
const db = { subs: {}, custs: {}, sessions: {} };
const checkoutCreates = [];
class FakeStripe {
  constructor() {
    this.webhooks = { constructEvent: (raw, sig) => { if (sig !== "good") throw new Error("bad sig"); return JSON.parse(raw); } };
    this.subscriptions = {
      retrieve: async id => structuredClone(db.subs[id]),
      list: async ({ customer, price }) => ({ data: Object.values(db.subs).filter(s => s.customer === customer && s.items.data.some(i => i.price.id === price)).map(s => structuredClone(s)) })
    };
    this.customers = {
      retrieve: async id => structuredClone(db.custs[id]),
      list: async ({ email }) => ({ data: Object.values(db.custs).filter(c => !c.deleted && c.email === email) })
    };
    this.checkout = { sessions: {
      retrieve: async (id, o) => { const s = structuredClone(db.sessions[id]); if (o?.expand?.includes("subscription")) s.subscription = structuredClone(db.subs[s.subscription]); return s; },
      create: async o => { checkoutCreates.push(o); return { id: "cs_new", url: "https://stripe/x" }; }
    } };
    this.billingPortal = { sessions: { create: async o => ({ url: "https://portal/" + o.customer }) } };
  }
}
mock.module("stripe", { defaultExport: FakeStripe });

// ---- fake fal
let falDelay = 0, cancelled = 0;
const fal = { config() {}, queue: { cancel: async () => { cancelled++; } },
  subscribe: (m, o) => new Promise((res, rej) => { o.onEnqueue?.("req1");
    const t = setTimeout(() => res({ data: { images: [{ url: "https://img" }] } }), falDelay);
    o.abortSignal?.addEventListener("abort", () => { clearTimeout(t); rej(new Error("aborted")); }); }) };
mock.module("@fal-ai/client", { namedExports: { fal } });

const sent = [];
globalThis.fetch = async (u, o) => {
  if (u === "https://img") return new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/webp" } });
  if (u.startsWith("https://api.resend.com")) { sent.push(JSON.parse(o.body)); return new Response("{}"); }
  throw new Error("unexpected fetch " + u);
};

Object.assign(process.env, { SESSION_SECRET: "s".repeat(32), STRIPE_SECRET_KEY: "sk", STRIPE_PRICE_ID: "price_pfp",
  STRIPE_WEBHOOK_SECRET: "whsec", FAL_KEY: "fk", URL: "https://pfpforge.example", RESEND_API_KEY: "re", DAILY_AI_LIMIT: "3" });

const L = await import("../lib/auth.mjs");
const fn = n => import(`../netlify/functions/${n}.mjs`).then(m => m.default);
const req = ({ method = "POST", headers = {}, body } = {}) =>
  new Request("https://pfpforge.example/x", { method, headers, body: method === "GET" ? undefined : typeof body === "string" ? body : JSON.stringify(body ?? {}) });
const call = async (name, opts, ctx = { ip: "1.1.1.1" }) => { const r = await (await fn(name))(req(opts), ctx); return { status: r.status, body: await r.text().then(t => { try { return JSON.parse(t); } catch { return t; } }) }; };
const hook = (type, object) => call("stripe-webhook", { headers: { "stripe-signature": "good" }, body: { type, data: { object } } });
const sub = (id, customer, status, price = "price_pfp") => (db.subs[id] = { id, customer, status, items: { data: [{ price: { id: price } }] } });
const cust = (id, email) => (db.custs[id] = { id, email });
const sess = email => ({ authorization: "Bearer " + L.signSession(email) });

test("webhook: checkout activates, cancel revokes, replayed checkout stays revoked", async () => {
  cust("cus_1", "A@x.com "); sub("sub_1", "cus_1", "active");
  assert.equal((await hook("checkout.session.completed", { mode: "subscription", subscription: "sub_1", customer_details: { email: "a@x.com" } })).status, 200);
  assert.equal(await L.isActiveEmail("a@x.com"), true);
  db.subs.sub_1.status = "canceled";
  await hook("customer.subscription.deleted", db.subs.sub_1);
  assert.equal(await L.isActiveEmail("a@x.com"), false);
  await hook("checkout.session.completed", { mode: "subscription", subscription: "sub_1" }); // late retry
  assert.equal(await L.isActiveEmail("a@x.com"), false);
});

test("webhook: other products don't grant Pro", async () => {
  cust("cus_2", "b@x.com"); sub("sub_2", "cus_2", "active", "price_other");
  await hook("customer.subscription.updated", db.subs.sub_2);
  assert.equal(await L.isActiveEmail("b@x.com"), false);
});

test("webhook: one subscription ending doesn't revoke Pro while another for the same email is paid", async () => {
  cust("cus_m1", "m@x.com"); sub("sub_m1", "cus_m1", "past_due");
  cust("cus_m2", "m@x.com"); sub("sub_m2", "cus_m2", "active");
  await hook("customer.subscription.updated", db.subs.sub_m2);
  db.subs.sub_m1.status = "canceled";
  await hook("customer.subscription.deleted", db.subs.sub_m1);
  assert.equal(await L.isActiveEmail("m@x.com"), true);
});

test("webhook: email change moves Pro at once (customer.updated); old email loses portal; deleted customer revokes", async () => {
  cust("cus_3", "old@x.com"); sub("sub_3", "cus_3", "active");
  await hook("customer.subscription.updated", db.subs.sub_3);
  const oldSession = sess("old@x.com");
  db.custs.cus_3.email = "new@x.com";
  await hook("customer.updated", db.custs.cus_3);
  assert.equal(await L.isActiveEmail("old@x.com"), false);
  assert.equal(await L.isActiveEmail("new@x.com"), true);
  assert.equal((await call("create-portal", { headers: oldSession })).status, 404);
  assert.equal((await call("create-portal", { headers: sess("new@x.com") })).body.url, "https://portal/cus_3");

  cust("cus_4", "d@x.com"); sub("sub_4", "cus_4", "active");
  await hook("customer.subscription.updated", db.subs.sub_4);
  db.custs.cus_4 = { id: "cus_4", deleted: true }; db.subs.sub_4.status = "canceled";
  await hook("customer.subscription.deleted", db.subs.sub_4);
  assert.equal(await L.isActiveEmail("d@x.com"), false);
});

test("webhook: bad signature rejected; payment_failed (new API shape) revokes", async () => {
  assert.equal((await call("stripe-webhook", { headers: { "stripe-signature": "bad" }, body: {} })).status, 400);
  cust("cus_5", "e@x.com"); sub("sub_5", "cus_5", "active");
  await hook("customer.subscription.updated", db.subs.sub_5);
  db.subs.sub_5.status = "past_due";
  await hook("invoice.payment_failed", { parent: { subscription_details: { subscription: "sub_5" } } });
  assert.equal(await L.isActiveEmail("e@x.com"), false);
});

test("auth-session: active works (even over an old inactive record), cancelled and stale links don't", async () => {
  await L.setEntitlement("f@x.com", { status: "inactive" });
  cust("cus_6", "f@x.com"); sub("sub_6", "cus_6", "active");
  db.sessions.cs_6 = { id: "cs_6", mode: "subscription", status: "complete", subscription: "sub_6", created: Date.now() / 1000 };
  let r = await call("auth-session", { body: { session_id: "cs_6" } });
  assert.equal(r.status, 200); assert.equal(r.body.email, "f@x.com");
  db.subs.sub_6.status = "canceled";
  assert.equal((await call("auth-session", { body: { session_id: "cs_6" } })).status, 403);
  db.sessions.cs_old = { ...db.sessions.cs_6, created: Date.now() / 1000 - 3 * 86400 };
  db.subs.sub_6.status = "active";
  assert.equal((await call("auth-session", { body: { session_id: "cs_old" } })).status, 410);
});

test("auth-request: link uses site URL not Origin; same response for unknown emails", async () => {
  await L.setEntitlement("g@x.com", { status: "active" });
  const t0 = Date.now();
  const r = await call("auth-request", { headers: { origin: "https://evil.example" }, body: { email: " G@x.com" } });
  assert.equal(r.status, 200); assert.ok(Date.now() - t0 >= 1400);
  assert.equal(sent.length, 1);
  assert.match(sent[0].html, /https:\/\/pfpforge\.example\/auth\.html#token=/);
  assert.doesNotMatch(sent[0].html, /evil/);
  const r2 = await call("auth-request", { body: { email: "nobody@x.com" } });
  assert.deepEqual(r2.body, r.body); assert.equal(sent.length, 1);
});

test("auth-verify: links work once, even when used in parallel; login token can't open portal or AI", async () => {
  await L.setEntitlement("h@x.com", { status: "active", customerId: "cus_h" });
  const login = L.signLogin("h@x.com");
  const auth = { authorization: "Bearer " + login };
  assert.equal((await call("create-portal", { headers: auth })).status, 401);
  assert.equal((await call("transform", { headers: auth })).status, 401);
  assert.deepEqual((await call("me", { method: "GET", headers: auth })).body, { pro: false });
  const results = await Promise.all([1, 2, 3].map(() => call("auth-verify", { body: { token: login } })));
  assert.equal(results.filter(r => r.status === 200).length, 1);
  const tok = results.find(r => r.status === 200).body.token;
  assert.equal((await call("create-portal", { headers: { authorization: "Bearer " + tok } })).status, 200);
});

test("transform: gate, validation, parallel-safe daily cap, timeout, kill switch", async () => {
  await L.setEntitlement("i@x.com", { status: "active" });
  const h = sess("i@x.com"), img = "data:image/jpeg;base64,AAAA";
  assert.equal((await call("transform", {})).status, 401);
  assert.equal((await call("transform", { headers: h, body: { prompt: "x", image: "https://evil" } })).status, 400);
  assert.equal((await call("transform", { headers: h, body: { prompt: "x".repeat(2000), image: img } })).status, 400);
  const ok = await call("transform", { headers: h, body: { prompt: "x", image: img } });
  assert.equal(ok.status, 200); assert.match(ok.body.image, /^data:image\/webp;base64,/);
  process.env.FUNCTION_TIMEOUT_S = "5"; falDelay = 10000;
  assert.equal((await call("transform", { headers: h, body: { prompt: "x", image: img } })).status, 504);
  assert.equal(cancelled, 1);
  falDelay = 0; delete process.env.FUNCTION_TIMEOUT_S;
  // 2 of 3 used; fire 6 at once: exactly 1 more may pass
  const burst = await Promise.all(Array.from({ length: 6 }, () => call("transform", { headers: h, body: { prompt: "x", image: img } })));
  assert.equal(burst.filter(r => r.status === 200).length, 1);
  assert.equal(burst.filter(r => r.status === 429).length, 5);
  process.env.AI_ENABLED = "false";
  assert.equal((await call("transform", { headers: h })).status, 503);
  delete process.env.AI_ENABLED;
});

test("create-checkout: reuses the logged-in subscriber's Stripe customer", async () => {
  await L.setEntitlement("k@x.com", { status: "inactive", customerId: "cus_k" });
  await call("create-checkout", { headers: sess("k@x.com") });
  assert.equal(checkoutCreates.at(-1).customer, "cus_k");
  await call("create-checkout", {});
  assert.equal(checkoutCreates.at(-1).customer, undefined);
  assert.match(checkoutCreates.at(-1).success_url, /^https:\/\/pfpforge\.example\/success\.html/);
});

test("legacy pro:true session tokens still work; empty secret fails closed", async () => {
  const jwt = (await import("jsonwebtoken")).default;
  const legacy = jwt.sign({ email: "j@x.com", pro: true }, process.env.SESSION_SECRET, { expiresIn: "1d" });
  assert.equal(L.sessionEmail(req({ headers: { authorization: "Bearer " + legacy } })), "j@x.com");
  const s = process.env.SESSION_SECRET; process.env.SESSION_SECRET = "";
  assert.equal(L.verify(legacy), null); assert.throws(() => L.signSession("j@x.com"));
  process.env.SESSION_SECRET = s;
});
