import { init, verify, signSession, isActiveEmail, consumeOnce, json } from "../../lib/auth.mjs";

/* Validates the 15-minute login token from the email link and, if the email
   still has an active subscription, returns a 30-day session token.
   Each link works once. */

export const handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });
  init(event);
  try {
    const { token } = JSON.parse(event.body || "{}");
    const payload = verify(token || "");
    if (!payload?.email || payload.typ !== "login" || !payload.jti) return json(401, { error: "Invalid or expired link" });
    if (!(await consumeOnce(payload.jti))) return json(401, { error: "This link was already used — request a new one." });
    if (!(await isActiveEmail(payload.email))) return json(403, { error: "No active subscription for this email" });
    return json(200, { token: signSession(payload.email), email: payload.email });
  } catch (err) {
    console.error(err);
    return json(500, { error: "Something went wrong. Please request a new link." });
  }
};
