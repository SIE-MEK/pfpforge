# PFPFORGE — Launch Checklist

Tick these top to bottom. Nothing here charges real money until **Section 5**,
so you can safely work through 1–4 first.

---

## 1. Deploy the site
- [ ] Push the `pfp-generator` folder to a GitHub repo.
- [ ] Netlify → Add new site → Import from GitHub → pick the repo.
- [ ] Build command: blank. Publish directory: `.`
- [ ] Site loads. The free in-browser forge works (upload → pick aesthetic → Forge → Download).
- [ ] Blog loads at `/blog/` and the "Guides" nav link works.

## 2. Set your domain everywhere
- [ ] Run `node scripts/set-domain.mjs yourdomain.com you@youremail.com` (your real
      domain and the contact email for the Privacy/Terms pages), then commit and push.
      This fills in `sitemap.xml`, `robots.txt`, the canonical + `og:` tags on every
      page, and the contact address in `privacy.html` / `terms.html`.
- [ ] Submit `https://YOURDOMAIN.com/sitemap.xml` in Google Search Console.

## 3. Environment variables (Netlify → Site configuration → Environment variables)
- [ ] `FAL_KEY` — your fal.ai key (AI image transforms)
- [ ] `STRIPE_SECRET_KEY` — start with **sk_test_** for now
- [ ] `STRIPE_PRICE_ID` — a **test-mode** $4.99/mo recurring price
- [ ] `STRIPE_WEBHOOK_SECRET` — from the webhook you create in step 4
- [ ] `SESSION_SECRET` — long random string (`openssl rand -hex 32`)
- [ ] `RESEND_API_KEY` — optional (only for cross-device email login)
- [ ] In `index.html`, set `STRIPE_PK` to your **pk_test_** key for now
- [ ] Set `USE_AI = true` in `index.html`

## 4. Stripe webhook
- [ ] Stripe → Developers → Webhooks → Add endpoint
- [ ] URL: `https://YOURDOMAIN.com/.netlify/functions/stripe-webhook`
- [ ] Events: `checkout.session.completed`, `customer.subscription.updated`,
      `customer.subscription.deleted`, `invoice.payment_failed`
- [ ] Copy the `whsec_…` signing secret into `STRIPE_WEBHOOK_SECRET`, redeploy.
- [ ] Stripe → Settings → Billing → **Customer portal** → turn on "cancel
      subscriptions" and **Save** (needed once in test mode and once in live mode,
      or "Manage subscription" fails).

## 5. Test the money flow IN TEST MODE (see TESTS.md)
- [ ] Run every check in TESTS.md and confirm each passes.
- [ ] Only proceed once they all pass.

## 6. Go live (this starts charging real cards)
- [ ] Swap `STRIPE_PK` in `index.html` to your **pk_live_** key
      (your live key is already in the file — just confirm it's the live one).
- [ ] Swap Netlify `STRIPE_SECRET_KEY` to **sk_live_** and `STRIPE_PRICE_ID`
      to your **live** $4.99/mo price.
- [ ] Re-create the webhook in **live mode** and update `STRIPE_WEBHOOK_SECRET`.
- [ ] Enable **PayPal** in Stripe → Payment methods, plus **recurring payments**
      (allow up to ~5 business days for PayPal to approve recurring).
- [ ] Redeploy.

## 7. AdSense
- [ ] Add your `ca-pub-…` verification script in `<head>` (see SETUP.md).
- [ ] Paste your ad-unit code into the `<!-- AD UNIT -->` and `.ad-slot` spots.
- [ ] Paste the same `ca-pub-…` script into the commented AdSense line in the
      `<head>` of each `/blog/` page too.
- [ ] Verify + request review in AdSense.
- [ ] Visitors from the EU/UK need a Google-certified consent banner: in AdSense →
      Privacy & messaging, turn on the free European regulations message.

## 8. Traffic
- [ ] Make your first Pinterest video pins in Kittl.
- [ ] Title/description use trending keywords from Pinterest Trends.
- [ ] Pins link to your live site.

---

### Quick rollback
If anything misbehaves after going live, set `USE_AI = false` in `index.html`
and redeploy — the site falls back to the free in-browser filter for everyone
and stops all AI spend immediately, without taking the site down.
