import Stripe from "stripe";

/* ---------------------------------------------------------------------------
   PFPFORGE — Stripe Checkout session creator (Netlify Function)
   Creates a subscription Checkout Session and returns its URL. The browser
   redirects there; Stripe collects the card on its own hosted page, so card
   details never touch your site.

   SECRETS (set in Netlify → Site configuration → Environment variables):
     STRIPE_SECRET_KEY   your sk_live_… (use sk_test_… while testing)
     STRIPE_PRICE_ID     the Price you create in the Stripe dashboard
                         (recurring, $4.99/month) — looks like price_123...

   The publishable key (pk_live_…) is NOT used here — it lives in index.html.
--------------------------------------------------------------------------- */

export const handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });
  if (!process.env.STRIPE_SECRET_KEY) return json(500, { error: "STRIPE_SECRET_KEY is not set on the server" });
  if (!process.env.STRIPE_PRICE_ID)   return json(500, { error: "STRIPE_PRICE_ID is not set on the server" });

  try {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const origin = event.headers.origin || `https://${event.headers.host}`;

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
      allow_promotion_codes: true,
      success_url: `${origin}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/index.html#pro`
    });

    return json(200, { id: session.id, url: session.url });
  } catch (err) {
    console.error(err);
    return json(500, { error: String(err?.message || err) });
  }
};

function json(statusCode, obj) {
  return { statusCode, headers: { "Content-Type": "application/json" }, body: JSON.stringify(obj) };
}
