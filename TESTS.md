# PFPFORGE — Test Before You Launch

Run these in **Stripe test mode** (pk_test_ / sk_test_ keys, test price ID).
Stripe's test card is `4242 4242 4242 4242`, any future expiry, any CVC, any ZIP.
None of this moves real money.

---

## A. Free tier still works (no login)
1. Open the site in a normal browser window (not logged in).
2. Upload a photo → pick an aesthetic → **Forge**.
   - ✅ You get a styled image you can download.
   - ✅ It used the in-browser filter (no charge, instant).
3. Confirm the Pro section shows **"Upgrade to Pro"** (not "Manage subscription").

## B. AI is gated until you pay
1. While still not logged in, open the browser console and run:
   `fetch('/.netlify/functions/transform',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).then(r=>console.log(r.status))`
   - ✅ Logs **401** (or 403). The function refuses to spend without an active subscriber.
2. Try faking it: in console run `localStorage.setItem('pfp_pro','1')` and reload.
   - ✅ Nothing unlocks — ads stay, and uploading + Forge still uses the
     **filter**. The UI and the AI both key off a server-verified token, not
     this flag, so editing storage does nothing.
   - Clear it after: `localStorage.removeItem('pfp_pro')`.

## C. Checkout → unlock (the happy path)
1. Click **Upgrade to Pro**.
   - ✅ Redirects to Stripe Checkout showing the $4.99/mo plan.
   - ✅ Card is offered. (PayPal only appears in **live** mode once approved — see note.)
2. Pay with `4242 4242 4242 4242`.
   - ✅ Lands on `success.html` ("You're Pro now").
3. Go back to the site / reload.
   - ✅ Pro section now shows **"Manage subscription"**.
   - ✅ Ad slots are hidden.
4. Upload a photo → Forge.
   - ✅ Now it calls the **AI** (a few seconds, more dramatic result), not the filter.

## D. Webhook recorded it
1. Stripe Dashboard (test mode) → Developers → Webhooks → your endpoint.
   - ✅ Recent `checkout.session.completed` delivery shows **200**.
2. Netlify → your site → Logs → Functions → `stripe-webhook`.
   - ✅ No errors logged.

## E. Manage / cancel
1. Click **Manage subscription**.
   - ✅ Opens Stripe's billing portal for your test customer.
2. Cancel the subscription there, return to the site, reload.
   - ✅ Within a moment, "Manage subscription" is gone / AI is locked again
     (the `customer.subscription.deleted` webhook flipped you to inactive).

## F. Cross-device restore (only if RESEND_API_KEY is set)
1. In a fresh browser (or incognito), open the Pro section.
2. Click **"Already Pro on another device? Email me a login link"**, enter the
   email you paid with.
   - ✅ You get the same "if that email has an active subscription…" message
     whether or not the email is real (it never reveals who's a subscriber).
3. Check that inbox → click the link → it opens `auth.html` → redirects back.
   - ✅ You're Pro on this browser now.
4. Enter a **random** email that never subscribed.
   - ✅ Same message, but **no email arrives** and nothing unlocks.

---

### Note on PayPal in testing
PayPal generally won't show in the checkout until it's enabled in **live** mode
and approved for recurring payments. Test the card flow now; verify PayPal with
one small real purchase (then refund yourself) after you go live.

### If a test fails
- **Checkout button errors** → `STRIPE_SECRET_KEY` or `STRIPE_PRICE_ID` missing/wrong in Netlify.
- **Pays but never unlocks** → webhook URL wrong, wrong events selected, or
  `STRIPE_WEBHOOK_SECRET` mismatch. Check the webhook's delivery log in Stripe.
- **AI still says locked after paying** → `SESSION_SECRET` not set, or you're on
  a different browser than you paid in (use the email-link restore).
- **AI times out** → heavy model; the default (nano-banana-2) is fast — see
  SETUP.md troubleshooting.
