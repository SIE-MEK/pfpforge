import Stripe from "stripe";
import { setEntitlement } from "../../lib/auth.mjs";

/* Stripe webhook — the source of truth for who is a paying subscriber.
   Configure in Stripe Dashboard → Developers → Webhooks, pointing at
   /.netlify/functions/stripe-webhook, sending these events:
     checkout.session.completed
     customer.subscription.updated
     customer.subscription.deleted
     invoice.payment_failed
   Copy the signing secret into the STRIPE_WEBHOOK_SECRET env var. */

export const handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode: 405, body: "POST only" };
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return { statusCode: 500, body: "STRIPE_WEBHOOK_SECRET not set" };

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const sig = event.headers["stripe-signature"];
  let raw = event.body;
  if (event.isBase64Encoded) raw = Buffer.from(event.body, "base64").toString("utf8");

  let evt;
  try { evt = stripe.webhooks.constructEvent(raw, sig, secret); }
  catch (err) { return { statusCode: 400, body: `Webhook signature failed: ${err.message}` }; }

  try {
    if (evt.type === "checkout.session.completed") {
      const s = evt.data.object;
      const email = s.customer_details?.email || s.customer_email;
      if (email) await setEntitlement(email, { status: "active", customerId: s.customer, subId: s.subscription });
    } else if (evt.type === "customer.subscription.updated" || evt.type === "customer.subscription.deleted") {
      const sub = evt.data.object;
      const active = (sub.status === "active" || sub.status === "trialing") && evt.type !== "customer.subscription.deleted";
      const cust = await stripe.customers.retrieve(sub.customer);
      if (cust?.email) await setEntitlement(cust.email, { status: active ? "active" : "inactive", customerId: sub.customer, subId: sub.id });
    } else if (evt.type === "invoice.payment_failed") {
      const inv = evt.data.object;
      const cust = await stripe.customers.retrieve(inv.customer);
      if (cust?.email) await setEntitlement(cust.email, { status: "inactive", customerId: inv.customer });
    }
  } catch (err) {
    console.error("webhook handler error", err);
    return { statusCode: 500, body: "handler error" }; // let Stripe retry
  }
  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
