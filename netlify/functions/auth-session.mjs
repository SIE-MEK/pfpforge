import Stripe from "stripe";
import { signSession, setEntitlement, json } from "../../lib/auth.mjs";

/* Called by success.html after checkout. Verifies the session_id with Stripe
   (so it can't be faked), records the entitlement, and returns a signed
   session token that unlocks Pro on this device. */

export const handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });
  if (!process.env.SESSION_SECRET) return json(500, { error: "SESSION_SECRET not set" });

  try {
    const { session_id } = JSON.parse(event.body || "{}");
    if (!session_id) return json(400, { error: "session_id required" });

    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const s = await stripe.checkout.sessions.retrieve(session_id);

    const paid = s.payment_status === "paid" || s.status === "complete";
    const email = s.customer_details?.email || s.customer_email;
    if (!paid || !email) return json(402, { error: "Payment not complete" });

    await setEntitlement(email, { status: "active", customerId: s.customer, subId: s.subscription });
    return json(200, { token: signSession(email), email });
  } catch (err) {
    console.error(err);
    return json(500, { error: String(err?.message || err) });
  }
};
