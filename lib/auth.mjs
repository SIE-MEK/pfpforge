import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import { getStore, connectLambda } from "@netlify/blobs";

/* Shared helpers for auth + entitlement.
   Entitlements are stored in Netlify Blobs (no external DB needed), keyed by
   the customer's email. Sessions are signed JWTs the server can verify, so a
   user can't fake Pro by editing browser storage. */

const SECRET = () => process.env.SESSION_SECRET || "";
const ALG = "HS256";

/* Every handler that touches Blobs must call this first. These functions use
   the Lambda-style `handler(event)` signature, and in that mode
   @netlify/blobs only gets its credentials from the event. */
export function init(event) {
  if (event?.blobs) connectLambda(event);
}

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
export function bearer(event) {
  const h = event.headers.authorization || event.headers.Authorization || "";
  return h.startsWith("Bearer ") ? h.slice(7) : null;
}
/* Email from a valid 30-day session token, or null. Login-link tokens are
   rejected. Tokens issued before `typ` existed carried `pro: true`. */
export function sessionEmail(event) {
  const p = verify(bearer(event));
  if (!p?.email) return null;
  if (p.typ === "session" || (!p.typ && p.pro === true)) return normEmail(p.email);
  return null;
}

const entitlements = () => getStore("entitlements");
const customers = () => getStore("customers");   // Stripe customer id -> email we granted Pro to

export async function setEntitlement(email, data) {
  await entitlements().setJSON(normEmail(email), { ...data, updated: Date.now() });
}
export async function getEntitlement(email) {
  if (!email) return null;
  try { return await entitlements().get(normEmail(email), { type: "json" }); }
  catch (e) { console.error("getEntitlement", e); return null; }
}
export async function isActiveEmail(email) {
  const e = await getEntitlement(email);
  return !!(e && e.status === "active");
}

/* Write a subscription's LIVE state from Stripe into the entitlement store.
   Always pass a subscription freshly retrieved from Stripe, never a webhook
   payload: that makes the result the same whatever order events arrive in
   and however often Stripe redelivers them.
   Returns the email written, or null if the subscription isn't PFPFORGE Pro. */
export async function syncSubscription(stripe, sub, emailHint) {
  const priceId = process.env.STRIPE_PRICE_ID;
  if (!priceId) throw new Error("STRIPE_PRICE_ID is not set");
  const isPfp = (sub.items?.data || []).some(i => i.price?.id === priceId);
  if (!isPfp) return null; // another product on the same Stripe account

  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
  const active = sub.status === "active" || sub.status === "trialing";

  const prev = await customers().get(customerId, { type: "json" }).catch(() => null);
  let current = null;
  try {
    const cust = await stripe.customers.retrieve(customerId);
    if (!cust.deleted && cust.email) current = normEmail(cust.email);
  } catch (e) { console.error("customer lookup", e); }
  current = current || prev?.email || (emailHint ? normEmail(emailHint) : null);
  if (!current) return null;

  // Customer changed their email: the old address must stop working.
  if (prev?.email && prev.email !== current) {
    await setEntitlement(prev.email, { status: "inactive", customerId, subId: sub.id, movedTo: current });
  }
  await setEntitlement(current, { status: active ? "active" : "inactive", customerId, subId: sub.id, stripeStatus: sub.status });
  await customers().setJSON(customerId, { email: current, updated: Date.now() });
  return current;
}

/* Simple fixed-window counter in Blobs. Not atomic, so a burst of parallel
   requests can slip a few over the limit; fine for abuse prevention.
   Returns true if this hit is within the limit. */
export async function hit(bucket, key, limit, windowMs) {
  const store = getStore("ratelimit");
  const win = Math.floor(Date.now() / windowMs);
  const k = `${bucket}/${win}/${key}`;
  const n = Number(await store.get(k).catch(() => null)) || 0;
  if (n >= limit) return false;
  await store.set(k, String(n + 1));
  return true;
}

/* One-time use for login links: returns false if this id was already used. */
export async function consumeOnce(id) {
  const store = getStore("used-logins");
  if (await store.get(id).catch(() => null)) return false;
  await store.set(id, String(Date.now()));
  return true;
}

export function json(statusCode, obj) {
  return { statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) };
}
