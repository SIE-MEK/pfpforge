import Stripe from "stripe";
import { sessionEmail, getEntitlement, siteUrl, json } from "../../lib/auth.mjs";

/* ---------------------------------------------------------------------------
   PFPFORGE — Stripe Checkout session creator (Netlify Function)
   Creates a subscription Checkout Session and returns its URL. The browser
   redirects there; Stripe collects the card on its own hosted page, so card
   details never touch your site.

   SECRETS (set in Netlify → Site configuration → Environment variables):
     STRIPE_SECRET_KEY   your sk_live_… (use sk_test_… while testing)
     STRIPE_PRICE_ID     the Price you create in the Stripe dashboard
                         (recurring, $4.99/month) — looks like price_123...
     SITE_URL            optional; defaults to Netlify's URL for the site

   The publishable key (pk_live_…) is NOT used here — it lives in index.html.
--------------------------------------------------------------------------- */

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "POST only" });
  if (!process.env.STRIPE_SECRET_KEY) return json(500, { error: "STRIPE_SECRET_KEY is not set on the server" });
  if (!process.env.STRIPE_PRICE_ID)   return json(500, { error: "STRIPE_PRICE_ID is not set on the server" });

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const origin = siteUrl();

    // Returning subscriber (e.g. after a failed renewal): reuse their Stripe
    // customer instead of creating a second one for the same email.
    const email = sessionEmail(req);
    const customer = email ? (await getEntitlement(email))?.customerId : null;

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
      allow_promotion_codes: true,
      ...(customer ? { customer } : {}),
      success_url: `${origin}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/index.html#pro`
    });

    return json(200, { id: session.id, url: session.url });
  } catch (err) {
    console.error(err);
    return json(500, { error: "Could not start checkout" });
  }
};
