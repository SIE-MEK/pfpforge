import { bearer, verify, isActiveEmail, json } from "../../lib/auth.mjs";

/* The site calls this on load with the saved session token. It re-checks the
   live entitlement (so a cancellation revokes access even before the token
   expires). Returns { pro: true|false }. */

export const handler = async (event) => {
  const token = bearer(event);
  if (!token) return json(200, { pro: false });
  const payload = verify(token);
  if (!payload?.email || payload.typ === "login") return json(200, { pro: false });
  const active = await isActiveEmail(payload.email);
  return json(200, { pro: active, email: payload.email });
};
