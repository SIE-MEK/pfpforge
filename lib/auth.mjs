import jwt from "jsonwebtoken";
import { getStore, connectLambda } from "@netlify/blobs";

/* Shared helpers for auth + entitlement.
   Entitlements are stored in Netlify Blobs (no external DB needed), keyed by
   the customer's email. Sessions are signed JWTs the server can verify, so a
   user can't fake Pro by editing browser storage. */

const SECRET = () => process.env.SESSION_SECRET || "";

export function signSession(email) {
  return jwt.sign({ email: email.toLowerCase(), pro: true }, SECRET(), { expiresIn: "30d" });
}
export function signLogin(email) {
  return jwt.sign({ email: email.toLowerCase(), typ: "login" }, SECRET(), { expiresIn: "15m" });
}
export function verify(token) {
  try { return jwt.verify(token, SECRET()); } catch (e) { return null; }
}
export function bearer(event) {
  const h = event.headers.authorization || event.headers.Authorization || "";
  return h.startsWith("Bearer ") ? h.slice(7) : null;
}

/* These functions use the Lambda-style `handler` export, so Netlify Blobs must
   be wired up from the incoming event before getStore() works. Call this
   first in every handler that reads or writes entitlements. */
export function connect(event) {
  try { connectLambda(event); } catch (e) { /* not on Netlify (local tests) */ }
}

/* The site's own public URL, for links we generate (checkout return, portal,
   login emails). Netlify sets URL to the primary site address. Never build
   these from the request's Origin header: anyone can forge it, which would let
   an attacker get a real login email sent that points at their own site. */
export function siteOrigin(event) {
  return (process.env.URL || `https://${event.headers.host}`).replace(/\/$/, "");
}

function store() { return getStore("entitlements"); }

export async function setEntitlement(email, data) {
  await store().setJSON(email.toLowerCase(), { ...data, updated: Date.now() });
}
export async function getEntitlement(email) {
  if (!email) return null;
  try { return await store().get(email.toLowerCase(), { type: "json" }); }
  catch (e) { return null; }
}
export async function isActiveEmail(email) {
  const e = await getEntitlement(email);
  return !!(e && e.status === "active");
}

export function json(statusCode, obj) {
  return { statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) };
}
