import Stripe from "stripe";
import { init, signSession, syncSubscription, isActiveEmail, json } from "../../lib/auth.mjs";

/* Called by success.html after checkout. Looks the session up with Stripe
   (so it can't be faked), syncs the subscription's LIVE status (in case the
   webhook hasn't landed yet), and returns a signed session token only if that
   subscription is active right now. An old success URL from a cancelled
   subscription therefore unlocks nothing. */

const MAX_AGE_S = 24 * 60 * 60; // after a day, use the emailed login link instead

export const handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });
  if (!process.env.SESSION_SECRET) return json(500, { error: "Server not configured" });
  init(event);

  try {
    const { session_id } = JSON.parse(event.body || "{}");
    if (typeof session_id !== "string" || !session_id.startsWith("cs_")) return json(400, { error: "session_id required" });

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const s = await stripe.checkout.sessions.retrieve(session_id, { expand: ["subscription"] });

    if (s.mode !== "subscription" || s.status !== "complete" || !s.subscription) {
      return json(402, { error: "Payment not complete" });
    }
    if (Date.now() / 1000 - s.created > MAX_AGE_S) {
      return json(410, { error: "This checkout link has expired. Use \"Email me a login link\" on the site instead." });
    }

    const email = await syncSubscription(stripe, s.subscription, s.customer_details?.email || s.customer_email);
    if (!email || !(await isActiveEmail(email))) return json(403, { error: "No active Pro subscription" });

    return json(200, { token: signSession(email), email });
  } catch (err) {
    console.error(err);
    return json(500, { error: "Could not verify your checkout. Please try again." });
  }
};
