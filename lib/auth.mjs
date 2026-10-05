import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { getStore } from "@netlify/blobs";

/* Shared helpers for auth + entitlement.
   Entitlements are stored in Netlify Blobs (no external DB needed), keyed by
   the customer's email. Sessions are signed JWTs the server can verify, so a
   user can't fake Pro by editing browser storage.

   The functions use Netlify's modern `export default async (req, context)`
   format. That's what lets Blobs use strong consistency: reads always see the
   latest write, and conditional writes make counters and one-time links safe
   under parallel requests. */

const SECRET = () => process.env.SESSION_SECRET || "";
const ALG = "HS256";
const store = name => getStore({ name, consistency: "strong" });

export function normEmail(email) {
  return String(email || "").trim().toLowerCase();
}
export function isEmail(email) {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/* The site's own public URL, used for every link we hand out (login emails,
   Stripe redirects). Never built from request headers: Origin/Host are
   attacker-controlled. URL is set automatically by Netlify. */
export function siteUrl() {
  const u = process.env.SITE_URL || process.env.URL;
  if (!u) throw new Error("SITE_URL (or Netlify's URL) is not set");
  return u.replace(/\/+$/, "");
}

function requireSecret() {
  if (!SECRET()) throw new Error("SESSION_SECRET is not set");
  return SECRET();
}
export function signSession(email) {
  return jwt.sign({ email: normEmail(email), typ: "session" }, requireSecret(), { algorithm: ALG, expiresIn: "30d" });
}
export function signLogin(email) {
  return jwt.sign({ email: normEmail(email), typ: "login", jti: crypto.randomUUID() }, requireSecret(), { algorithm: ALG, expiresIn: "15m" });
}
export function verify(token) {
  if (!SECRET() || !token) return null;
  try { return jwt.verify(token, SECRET(), { algorithms: [ALG] }); } catch (e) { return null; }
}
export function bearer(req) {
  const h = req.headers.get("authorization") || "";
  return h.startsWith("Bearer ") ? h.slice(7) : null;
}
/* Email from a valid 30-day session token, or null. Login-link tokens are
   rejected. Tokens issued before `typ` existed carried `pro: true`. */
export function sessionEmail(req) {
  const p = verify(bearer(req));
  if (!p?.email) return null;
  if (p.typ === "session" || (!p.typ && p.pro === true)) return normEmail(p.email);
  return null;
}
export async function readJSON(req) {
  try { return await req.json(); } catch (e) { return {}; }
}

export async function setEntitlement(email, data) {
  await store("entitlements").setJSON(normEmail(email), { ...data, updated: Date.now() });
}
export async function getEntitlement(email) {
  if (!email) return null;
  try { return await store("entitlements").get(normEmail(email), { type: "json" }); }
  catch (e) { console.error("getEntitlement", e); return null; }
}
export async function isActiveEmail(email) {
  const e = await getEntitlement(email);
  return !!(e && e.status === "active");
}

const LIVE = new Set(["active", "trialing"]);

/* Is there ANY live PFPFORGE subscription for this email, across every Stripe
   customer that uses it? One email can end up with several customers (e.g.
   paying again after a failed renewal), so one subscription ending must not
   switch off Pro while another is still paid. Asks Stripe directly. */
async function emailStatus(stripe, email, customerIds = []) {
  const priceId = process.env.STRIPE_PRICE_ID;
  const ids = new Set(customerIds.filter(Boolean));
  const found = await stripe.customers.list({ email, limit: 20 });
  for (const c of found.data) ids.add(c.id);

  let fallback = null;
  for (const customer of ids) {
    const subs = await stripe.subscriptions.list({ customer, price: priceId, status: "all", limit: 20 });
    const live = subs.data.find(s => LIVE.has(s.status));
    if (live) return { active: true, customerId: customer, subId: live.id };
    if (subs.data.length && !fallback) fallback = { customerId: customer, subId: subs.data[0].id };
  }
  return { active: false, customerId: fallback?.customerId || null, subId: fallback?.subId || null };
}

/* Bring the entitlement store in line with Stripe after something changed on
   this subscription (or its customer). Everything is re-read from Stripe, so
   retries and out-of-order webhooks can't leave anyone wrongly active.
   Returns { email, active }, or null if this isn't a PFPFORGE subscription. */
export async function syncSubscription(stripe, sub, emailHint) {
  const priceId = process.env.STRIPE_PRICE_ID;
  if (!priceId) throw new Error("STRIPE_PRICE_ID is not set");
  const isPfp = (sub.items?.data || []).some(i => i.price?.id === priceId);
  if (!isPfp) return null; // another product on the same Stripe account

  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
  const index = store("customers");   // Stripe customer id -> email we granted Pro to
  const prev = await index.get(customerId, { type: "json" }).catch(() => null);

  let current = null;
  try {
    const cust = await stripe.customers.retrieve(customerId);
    if (!cust.deleted && cust.email) current = normEmail(cust.email);
  } catch (e) { console.error("customer lookup", e); }
  current = current || prev?.email || (emailHint ? normEmail(emailHint) : null);
  if (!current) return null;

  // Customer changed their email: the old address keeps Pro only if it has
  // its own live subscription, and never keeps access to this customer.
  if (prev?.email && prev.email !== current) {
    const old = await emailStatus(stripe, prev.email);
    await setEntitlement(prev.email, { status: old.active ? "active" : "inactive", customerId: old.customerId, subId: old.subId, movedTo: current });
  }

  const st = await emailStatus(stripe, current, [customerId]);
  await setEntitlement(current, { status: st.active ? "active" : "inactive", customerId: st.customerId || customerId, subId: st.subId || sub.id });
  await index.setJSON(customerId, { email: current, updated: Date.now() });
  return { email: current, active: st.active };
}

/* Fixed-window counter. Uses compare-and-set writes, so parallel requests
   can't push it past the limit. Returns true if this hit is within it. */
export async function hit(bucket, key, limit, windowMs) {
  const s = store("ratelimit");
  const k = `${bucket}/${Math.floor(Date.now() / windowMs)}/${key}`;
  for (let attempt = 0; attempt < 5; attempt++) {
    const cur = await s.getWithMetadata(k, { type: "text" });
    const n = Number(cur?.data) || 0;
    if (n >= limit) return false;
    const r = cur
      ? await s.set(k, String(n + 1), { onlyIfMatch: cur.etag })
      : await s.set(k, "1", { onlyIfNew: true });
    if (r.modified) return true;
  }
  return false; // heavy contention on one key: fail closed
}

/* One-time use for login links: returns false if this id was already used. */
export async function consumeOnce(id) {
  const r = await store("used-logins").set(id, String(Date.now()), { onlyIfNew: true });
  return r.modified;
}

export function json(status, obj) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
