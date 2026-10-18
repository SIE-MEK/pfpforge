import Stripe from "stripe";
import { syncSubscription } from "../../lib/auth.mjs";

/* Stripe webhook — the source of truth for who is a paying subscriber.
   Configure in Stripe Dashboard → Developers → Webhooks, pointing at
   /.netlify/functions/stripe-webhook, sending these events:
     checkout.session.completed
     customer.subscription.updated
     customer.subscription.deleted
     invoice.payment_failed
     customer.updated
   Copy the signing secret into the STRIPE_WEBHOOK_SECRET env var.

   Every event is treated as "this subscription changed": we re-read the
   subscription from Stripe and store its live status, so retries and
   out-of-order deliveries can't leave someone wrongly active. Subscriptions
   for other prices on the same Stripe account are ignored. */

export default async (req) => {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return new Response("STRIPE_WEBHOOK_SECRET not set", { status: 500 });

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const raw = await req.text();

  let evt;
  try { evt = stripe.webhooks.constructEvent(raw, req.headers.get("stripe-signature"), secret); }
  catch (err) { return new Response("Webhook signature failed", { status: 400 }); }

  try {
    const obj = evt.data.object;
    let subIds = [], emailHint = null;
    if (evt.type === "checkout.session.completed") {
      if (obj.mode === "subscription") subIds = [obj.subscription];
      emailHint = obj.customer_details?.email || obj.customer_email;
    } else if (evt.type.startsWith("customer.subscription.")) {
      subIds = [obj.id];
    } else if (evt.type === "invoice.payment_failed") {
      subIds = [obj.subscription || obj.parent?.subscription_details?.subscription];
    } else if (evt.type === "customer.updated") {
      // e.g. email changed in the billing portal: move Pro to the new address now
      const subs = await stripe.subscriptions.list({ customer: obj.id, price: process.env.STRIPE_PRICE_ID, status: "all", limit: 20 });
      subIds = subs.data.map(s => s.id);
    }
    for (const id of subIds.filter(Boolean)) {
      const sub = await stripe.subscriptions.retrieve(typeof id === "string" ? id : id.id);
      await syncSubscription(stripe, sub, emailHint);
    }
  } catch (err) {
    console.error("webhook handler error", err);
    return new Response("handler error", { status: 500 }); // let Stripe retry
  }
  return Response.json({ received: true });
};
