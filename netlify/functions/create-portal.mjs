import Stripe from "stripe";
import { sessionEmail, getEntitlement, siteUrl, json } from "../../lib/auth.mjs";

/* Returns a Stripe Customer Portal URL so a logged-in subscriber can update
   their card, view invoices, or cancel. Requires a full session token; a
   15-minute login-link token is not enough. */

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "POST only" });
  const email = sessionEmail(req);
  if (!email) return json(401, { error: "Not logged in" });

  const ent = await getEntitlement(email);
  if (!ent?.customerId) return json(404, { error: "No customer on file" });

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const portal = await stripe.billingPortal.sessions.create({
      customer: ent.customerId,
      return_url: `${siteUrl()}/index.html`
    });
    return json(200, { url: portal.url });
  } catch (err) {
    console.error(err);
    return json(500, { error: "Could not open the billing portal" });
  }
};
