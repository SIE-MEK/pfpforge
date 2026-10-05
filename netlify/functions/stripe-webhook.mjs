import Stripe from "stripe";
import { init, syncSubscription } from "../../lib/auth.mjs";

/* Stripe webhook — the source of truth for who is a paying subscriber.
   Configure in Stripe Dashboard → Developers → Webhooks, pointing at
   /.netlify/functions/stripe-webhook, sending these events:
     checkout.session.completed
     customer.subscription.updated
     customer.subscription.deleted
     invoice.payment_failed
   Copy the signing secret into the STRIPE_WEBHOOK_SECRET env var.

   Every event is treated as "this subscription changed": we re-read the
   subscription from Stripe and store its live status, so retries and
   out-of-order deliveries can't leave someone wrongly active. Subscriptions
   for other prices on the same Stripe account are ignored. */

export const handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "POST only" };
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return { statusCode: 500, body: "STRIPE_WEBHOOK_SECRET not set" };
  init(event);

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const sig = event.headers["stripe-signature"];
  let raw = event.body;
  if (event.isBase64Encoded) raw = Buffer.from(event.body, "base64").toString("utf8");

  let evt;
  try { evt = stripe.webhooks.constructEvent(raw, sig, secret); }
  catch (err) { return { statusCode: 400, body: "Webhook signature failed" }; }

  try {
    const obj = evt.data.object;
    let subId = null, emailHint = null;
    if (evt.type === "checkout.session.completed") {
      if (obj.mode === "subscription") subId = obj.subscription;
      emailHint = obj.customer_details?.email || obj.customer_email;
    } else if (evt.type.startsWith("customer.subscription.")) {
      subId = obj.id;
    } else if (evt.type === "invoice.payment_failed") {
      subId = obj.subscription || obj.parent?.subscription_details?.subscription;
    }
    if (subId) {
      const sub = await stripe.subscriptions.retrieve(typeof subId === "string" ? subId : subId.id);
      await syncSubscription(stripe, sub, emailHint);
    }
  } catch (err) {
    console.error("webhook handler error", err);
    return { statusCode: 500, body: "handler error" }; // let Stripe retry
  }
  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
