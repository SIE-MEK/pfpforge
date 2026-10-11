import Stripe from "stripe";
import { bearer, verify, getEntitlement, json, connect, siteOrigin } from "../../lib/auth.mjs";

/* Returns a Stripe Customer Portal URL so a logged-in subscriber can update
   their card, view invoices, or cancel. */

export const handler = async (event) => {
  connect(event);
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });
  const payload = verify(bearer(event) || "");
  if (!payload?.email || payload.typ === "login") return json(401, { error: "Not logged in" });

  const ent = await getEntitlement(payload.email);
  if (!ent?.customerId) return json(404, { error: "No customer on file" });

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const origin = siteOrigin(event);
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
