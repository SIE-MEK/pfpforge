import { isActiveEmail, signLogin, normEmail, isEmail, siteUrl, hit, readJSON, json } from "../../lib/auth.mjs";

/* "Already Pro on another device?" → emails a 15-minute login link.
   Email sending uses Resend (set RESEND_API_KEY). If it's not configured,
   this still returns ok so the UI doesn't leak who is a subscriber — but no
   email goes out. The purchase-device unlock works without this.

   Every request gets the same 200 response, padded to the same minimum
   duration, so neither the body nor the timing reveals who subscribes.
   Rate-limited per IP, and per email to stop inbox flooding. (Someone who
   knows a subscriber's email can use up that email's hourly allowance; the
   subscriber can still unlock on the device they paid on.) */

const MIN_MS = 1500;
const HOUR = 60 * 60 * 1000;

export default async (req, context) => {
  if (req.method !== "POST") return json(405, { error: "POST only" });
  const started = Date.now();

  const email = normEmail((await readJSON(req)).email);
  if (!isEmail(email)) return json(400, { error: "Please enter a valid email" });

  try {
    const ip = context?.ip || "unknown";
    if ((await hit("login-ip", ip, 10, HOUR)) && process.env.RESEND_API_KEY &&
        (await isActiveEmail(email)) && (await hit("login-email", email, 5, HOUR))) {
      const link = `${siteUrl()}/auth.html#token=${encodeURIComponent(signLogin(email))}`;
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: process.env.MAIL_FROM || "PFPFORGE <onboarding@resend.dev>",
          to: email,
          subject: "Your PFPFORGE Pro login link",
          html: `<p>Tap to unlock Pro on this device:</p><p><a href="${link}">Unlock PFPFORGE Pro</a></p><p>This link expires in 15 minutes and works once.</p>`
        })
      });
      if (!r.ok) console.error("Resend error", r.status, await r.text().catch(() => ""));
    }
  } catch (err) {
    console.error(err); // still answer the same way below
  }

  const wait = MIN_MS - (Date.now() - started);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  return json(200, { ok: true });
};
