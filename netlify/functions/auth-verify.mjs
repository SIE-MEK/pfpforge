import { verify, signSession, isActiveEmail, json } from "../../lib/auth.mjs";

/* Validates the 15-minute login token from the email link and, if the email
   still has an active subscription, returns a 30-day session token. */

export const handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });
  try {
    const { token } = JSON.parse(event.body || "{}");
    const payload = verify(token || "");
    if (!payload?.email || payload.typ !== "login") return json(401, { error: "Invalid or expired link" });
    if (!(await isActiveEmail(payload.email))) return json(403, { error: "No active subscription for this email" });
    return json(200, { token: signSession(payload.email), email: payload.email });
  } catch (err) {
    console.error(err);
    return json(500, { error: String(err?.message || err) });
  }
};
