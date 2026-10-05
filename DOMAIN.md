# PFPFORGE — Connect Your Hostinger Domain to Netlify

Goal: keep the site (and all the functions) hosted on Netlify, but use a domain
from your Hostinger account. You stay on Netlify's free hosting and your tested
code is untouched — Hostinger just provides the domain name.

Do these in order. The site must already be deployed on Netlify first, so you
have an address like `your-site-name.netlify.app` to point at.

---

## 1. Note your Netlify site address
After deploying, your site has an address like `your-site-name.netlify.app`.
You'll need that exact name in step 3.

## 2. Add the domain in Netlify
- Netlify → your site → **Domain management → Add a domain.**
- Type your domain (e.g. `siemekpfp.com`) → continue.
- Netlify will say DNS isn't configured yet. That's expected — step 3 fixes it.

## 3. Edit DNS records in Hostinger
- hPanel → **Domains** → click your domain → **DNS / Nameservers** (the DNS
  Zone Editor).
- Make these two changes:

**Apex / root domain (the bare `yourdomain.com`)**
- Find the existing `A` record with host `@` (points at Hostinger's server).
- Edit or delete it, then add:
  - Type: `A`
  - Host / Name: `@`
  - Value / Points to: `75.2.60.5`   ← Netlify's load balancer IP
- (Apex domains can't use a CNAME, which is why this is an A record.)

**www subdomain**
- Find any existing `www` record (A or CNAME) and remove it, then add:
  - Type: `CNAME`
  - Host / Name: `www`
  - Value / Points to: `your-site-name.netlify.app`   ← your address from step 1
- Leave TTL at the default. Save.

## 4. Wait, then verify
- DNS can take up to ~24 hours to propagate (often much faster).
- Back in Netlify → Domain management, the domain flips to verified and Netlify
  automatically issues a free HTTPS certificate. Nothing else to do.

---

## After the domain is live — update two things
(Both also in CHECKLIST.md.)

1. **Stripe webhook URL** → set it to
   `https://yourdomain.com/.netlify/functions/stripe-webhook`
2. **Domain references** → replace `YOURDOMAIN.com` in `sitemap.xml`,
   `robots.txt`, and the canonical + `og:` tags in `index.html` and `/blog/*`.

Your functions read the live host automatically, so checkout success/cancel
pages and PayPal use the real domain with no code change.

---

## Watch out for

**Leftover Hostinger records (the #1 cause of "didn't work after a day").**
If the domain previously served a Hostinger site, the OLD `@` A record and
`www` record must be *replaced*, not left next to the new ones. Duplicate A
records will fight each other.

**Hostinger email on this domain?** Don't touch the `MX` or `TXT` records — only
change the `A` (@) and `CNAME` (www) records above. Email keeps working.

**Still hitting Hostinger's parking page?** That's an old record still resolving,
or propagation not finished. Check the records again and give it more time; you
can confirm propagation with a "DNS checker" site by searching your domain.

---

## Alternative: hand all DNS to Netlify (optional, not recommended here)
Instead of the two records above, you can change the domain's **nameservers** in
Hostinger to the Netlify nameservers shown when you choose "Set up Netlify DNS"
in Domain management. This gives slightly better apex performance and fully
hands-off SSL, but you'd have to recreate any email/other DNS records inside
Netlify. The two-record method above keeps your Hostinger setup intact and is
the lower-risk choice, so prefer it unless you want Netlify managing everything.
