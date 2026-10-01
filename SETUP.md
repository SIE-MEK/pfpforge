# PFPFORGE — Setup Guide

You have three files plus a folder:

```
pfp-generator/
├─ index.html                      ← the website (works on its own, no setup needed)
├─ success.html                    ← shown after a successful Pro payment
├─ auth.html                       ← captures the email login link (cross-device)
├─ package.json                    ← lists dependencies
├─ sitemap.xml                     ← list of pages for Google (edit the domain)
├─ robots.txt                      ← tells crawlers where the sitemap is (edit the domain)
├─ SETUP.md                        ← this file
├─ CHECKLIST.md                    ← tick-through launch steps
├─ TESTS.md                        ← verify the money flow before going live
├─ DOMAIN.md                       ← point a Hostinger domain at the Netlify site
├─ lib/
│  └─ auth.mjs                     ← shared login + entitlement helpers
├─ blog/
│  ├─ index.html                   ← guides landing page
│  ├─ style.css                    ← shared styling for all blog pages
│  ├─ best-pfp-aesthetics-2026.html        ← pillar article
│  ├─ anime-pfp-ideas-2026.html
│  ├─ dark-academia-profile-picture-guide.html
│  └─ aesthetic-tiktok-pfp.html
└─ netlify/
   └─ functions/
      ├─ transform.mjs             ← AI proxy — now requires an active subscriber
      ├─ create-checkout.mjs       ← starts Stripe checkout (card + PayPal)
      ├─ stripe-webhook.mjs        ← records who paid (source of truth)
      ├─ auth-session.mjs          ← turns a paid checkout into a login token
      ├─ me.mjs                    ← tells the site if you're currently Pro
      ├─ create-portal.mjs         ← "manage subscription" billing portal
      ├─ auth-request.mjs          ← emails a login link (cross-device restore)
      └─ auth-verify.mjs           ← validates that link
```

---

## Option A — Just run the site (free, zero setup)

`index.html` is fully self-contained. Open it in a browser, or upload it to any
host (Hostinger, Netlify, your own server). The "Transform" and "Create"
buttons already work using fast in-browser styling. No API key, no cost.

This is enough to launch, drive Pinterest traffic, and turn on AdSense.

---

## Option B — Turn on real AI photo morphing

This upgrades the Transform button from filters to a true AI re-imagining of
the photo (real anime conversion, etc.). It needs an image API and a tiny
server function, because **your API key must never live in the website's code**
— anyone could view-source and steal it. The Netlify Function holds it safely.

### 1. Get a fal.ai key
- Sign up at **https://fal.ai**, add billing, and copy your API key from the
  dashboard. (fal gives you one key for hundreds of image models. You pay per
  image — typically a few cents each. Set a spending cap so a viral pin can't
  surprise you.)

### 2. Put the project on Netlify
- Push this `pfp-generator` folder to a GitHub repo (you already use Netlify
  for your reviews subdomain, so this is the same flow).
- In Netlify: **Add new site → Import from GitHub → pick the repo.**
- Build command: leave blank. Publish directory: `.` (the folder root).

### 3. Add your key as an environment variable
- Netlify site → **Site configuration → Environment variables → Add.**
- Key: `FAL_KEY`  •  Value: *(your fal.ai key)*  •  Save.
- This is the secret. It stays on Netlify's servers and is never sent to the browser.

### 4. Install the dependency
- Netlify installs it automatically from `package.json` on deploy. If you ever
  run locally, do `npm install` in the folder first.

### 5. Flip the switch in the website
- Open `index.html`, find this near the top of the `<script>`:
  ```js
  const USE_AI = false;
  ```
  Change it to:
  ```js
  const USE_AI = true;
  ```
- Save, commit, let Netlify redeploy. The Transform button now calls the AI.
  (If the AI ever errors, the site automatically falls back to the in-browser
  filter so users are never left with a dead button.)

---

## SEO: get the blog indexed (this is what pulls free traffic)

The site ships with a 4-article blog under `/blog/`, internally linked in a
hub-and-spoke pattern (the pillar post links to each guide and back). This
gives Google real content to rank and keeps visitors on the site longer —
which is exactly what lifts AdSense earnings per visitor.

To switch it on:

1. **Set your domain.** Find-and-replace `YOURDOMAIN.com` with your real domain
   in three files: `sitemap.xml`, `robots.txt`, and the `<link rel="canonical">`
   + `og:` tags at the top of each page in `/blog/` and `index.html`.
2. **Deploy**, then in **Google Search Console** add your site and submit
   `https://YOURDOMAIN.com/sitemap.xml` under Indexing → Sitemaps.
3. **Keep adding articles.** Each new guide targets more search terms. Copy any
   article in `/blog/` as a template, change the content, and add its URL to
   `sitemap.xml` and the list on `blog/index.html`. Use the trending keywords
   from Pinterest Trends (the ones from the video) as article topics.

The blog "Make my PFP" buttons deep-link into the tool with the right aesthetic
pre-selected (e.g. `index.html?aes=anime#forge`), so a reader lands ready to go.

---

## Charging for Pro ($4.99/mo) with Stripe

Pro unlocks the real AI morph and removes ads. Because AI transforms cost you
money per image, gating them behind Pro means **only paying customers ever
trigger that cost** — your safety valve against a viral pin running up an API
bill.

Your publishable key (`pk_live_…`) is already embedded in `index.html` — that
key is public by design, so this is safe. Here's the rest:

### 1. Create the product and price in Stripe
- Stripe Dashboard → **Products → Add product.**
- Name it "PFPFORGE Pro," set a **recurring** price of **$4.99 / month.**
- Save, then copy the **Price ID** (looks like `price_1ABC...`).

### 2. Add your server-side secrets to Netlify
- Netlify → **Site configuration → Environment variables → Add:**
  - `STRIPE_SECRET_KEY` = your `sk_live_…` secret key (NEVER put this in the site files)
  - `STRIPE_PRICE_ID` = the Price ID from step 1
- The `stripe` package installs automatically from `package.json` on deploy.

### 3. Test before going live (strongly recommended)
- Temporarily swap to **test mode**: put your `pk_test_…` key in `index.html`
  (replace the `STRIPE_PK` value) and your `sk_test_…` key in the Netlify
  `STRIPE_SECRET_KEY` var, with a test-mode Price ID.
- Deploy, click **Upgrade to Pro**, and pay with Stripe's test card
  `4242 4242 4242 4242`, any future expiry, any CVC.
- Confirm you land on `success.html` and the page goes ad-free / AI unlocks.
- Then switch both keys back to live. Done.

> ⚠️ You gave me a **live** publishable key, and it's embedded in `index.html`.
> The moment you deploy with your **live secret key** in Netlify, real cards (and
> PayPal) get charged. Do the test-mode pass above first so you never take real
> money before the unlock works end-to-end.

### 4. Turn on real (tamper-proof) Pro

Pro is now enforced on the **server**, not in the browser. Here's how it hangs
together: Stripe tells your `stripe-webhook` who paid → that's saved in
**Netlify Blobs** → when someone tries to use AI mode, the `transform` function
checks they have a valid login token *and* a live active subscription before it
spends a cent. Editing browser storage can't fake it.

To switch it on:

**a. Add these environment variables in Netlify** (Site configuration →
Environment variables), in addition to the Stripe ones above:
  - `SESSION_SECRET` — any long random string (e.g. run `openssl rand -hex 32`).
    This signs login tokens; keep it private.
  - `STRIPE_WEBHOOK_SECRET` — from step (b) below.
  - `RESEND_API_KEY` — *optional*, only needed for cross-device "email me a
    login link." Sign up at resend.com (free tier), create a key. Without it,
    buyers are still unlocked on the device they paid on; they just can't
    restore on a second device by email.
  - `MAIL_FROM` — *optional*, e.g. `PFPFORGE <hello@yourdomain.com>` once you've
    verified a domain in Resend. Defaults to a Resend test sender.

**b. Create the Stripe webhook**
  - Stripe Dashboard → Developers → Webhooks → **Add endpoint.**
  - URL: `https://YOURDOMAIN.com/.netlify/functions/stripe-webhook`
  - Events: `checkout.session.completed`, `customer.subscription.updated`,
    `customer.subscription.deleted`, `invoice.payment_failed`.
  - Save, copy the **Signing secret** (`whsec_…`) into `STRIPE_WEBHOOK_SECRET`.

**c. Netlify Blobs** needs no setup — it's built into Netlify Functions and
turns on automatically when the code uses it.

That's it. After deploy: a purchase unlocks Pro automatically, "Manage
subscription" opens Stripe's portal, cancelling revokes AI access on the next
check, and "Already Pro on another device?" emails a 15-minute login link.

---

## Adding PayPal as a payment option

PayPal runs **through Stripe** here — one checkout, one dashboard, one payout.
You connect PayPal with PayPal's own login; you never paste PayPal API keys
anywhere.

1. Stripe Dashboard → **Settings → Payment methods.**
2. Find **PayPal → Turn on.** You'll be sent to PayPal to authorize the link.
3. Because Pro is a subscription, also enable **recurring payments** for PayPal:
   on the PayPal payment-method panel, click **Enable** under *Recurring
   payments*. PayPal reviews this — it can take **up to ~5 business days** to go
   from "pending" to active.
4. Nothing to change in the code: the checkout already shows whatever methods
   you've enabled, so PayPal appears next to card automatically once it's active.

> If you specifically want money landing in your PayPal **balance** rather than
> settling through Stripe to your bank, that's a separate direct-PayPal
> integration — more moving parts for no real upside here. The Stripe-routed
> option above is the recommended one.

---

## Turning on Google AdSense (the monetization step)

1. In `index.html`, near the top, find the AdSense comment block in `<head>`.
2. Replace `ca-pub-XXXXXXXXXXXXXXXX` with your real publisher ID and uncomment
   that `<script>` line. This is the verification snippet AdSense asks you to
   place between the head tags.
3. Find the in-content `<!-- AD UNIT -->` block lower in the file and paste
   your ad-unit code there.
4. Deploy, then in AdSense click **Verify** and **Request review**.

---

## Troubleshooting

**"FAL_KEY env var is not set"** — You added `USE_AI = true` but didn't set the
`FAL_KEY` variable in Netlify (or didn't redeploy after adding it). Re-check
step 3, then trigger a new deploy.

**The AI request times out / falls back to the filter** — Netlify synchronous
functions cap at ~10 seconds (26s on some plans). The default model
(Nano Banana 2) is fast and usually finishes in time, but if you switch to a
heavier model and hit timeouts, fixes easiest-first:
- Stay on a *fast* model (the default `fal-ai/nano-banana-2/edit`, or another
  "fast"/"flash"/"schnell" endpoint on fal.ai).
- Raise the function timeout in Netlify if your plan allows.
- For heavy models, switch to a queue + webhook flow, or host the function on a
  platform with longer limits (Vercel, Cloudflare Workers).

**Faces look wrong / unrecognizable** — Edit the prompt logic in
`buildPrompt()` inside `index.html`, or switch `MODEL` to an identity-preserving
editor like Nano Banana. Adding "keep the same face, same features" to the
prompt helps.

**Download button does nothing after AI** — The function already returns the
image as base64 to avoid this. If you changed it to return a URL instead, the
canvas becomes "tainted" and downloads break — return base64.

**Costs creeping up** — Every AI transform is a paid API call. Keep the
free in-browser filter as the default for casual users and consider gating AI
mode (e.g., behind a daily limit) if a pin goes viral. Set a hard spend cap in
fal.ai.

---

## A realistic note

The in-browser version is genuinely free and launch-ready. The AI version is
better-looking but turns each transform into a small cost — so on an ad-funded
site, watch the math: if a flood of Pinterest traffic each runs several paid
transforms, API spend can outrun ad revenue. Many sites in this niche keep the
free filter as the default experience and treat true AI as an upsell or a
capped freebie. Build it, watch the numbers for a week, and adjust.
