import Stripe from "stripe";
import { bearer, verify, getEntitlement, json } from "../../lib/auth.mjs";

/* Returns a Stripe Customer Portal URL so a logged-in subscriber can update
   their card, view invoices, or cancel. */

export const handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });
  const payload = verify(bearer(event) || "");
  if (!payload?.email) return json(401, { error: "Not logged in" });

  const ent = await getEntitlement(payload.email);
  if (!ent?.customerId) return json(404, { error: "No customer on file" });

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const origin = event.headers.origin || `https://${event.headers.host}`;
    const portal = await stripe.billingPortal.sessions.create({
      customer: ent.customerId,
      return_url: `${origin}/index.html`
    });
    return json(200, { url: portal.url });
  } catch (err) {
    console.error(err);
    return json(500, { error: String(err?.message || err) });
  }
};
