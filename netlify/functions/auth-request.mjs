import { isActiveEmail, signLogin, json } from "../../lib/auth.mjs";

/* "Already Pro on another device?" → emails a 15-minute login link.
   Email sending uses Resend (set RESEND_API_KEY). If it's not configured,
   this still returns ok so the UI doesn't leak who is a subscriber — but no
   email goes out. The purchase-device unlock works without this. */

export const handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });
  try {
    const { email } = JSON.parse(event.body || "{}");
    if (!email) return json(400, { error: "email required" });

    const active = await isActiveEmail(email);
    if (active && process.env.RESEND_API_KEY) {
      const origin = event.headers.origin || `https://${event.headers.host}`;
      const link = `${origin}/auth.html#token=${encodeURIComponent(signLogin(email))}`;
      await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: process.env.MAIL_FROM || "PFPFORGE <onboarding@resend.dev>",
          to: email,
          subject: "Your PFPFORGE Pro login link",
          html: `<p>Tap to unlock Pro on this device:</p><p><a href="${link}">Unlock PFPFORGE Pro</a></p><p>This link expires in 15 minutes.</p>`
        })
      });
    }
    // Always the same response, regardless of whether the email is a subscriber.
    return json(200, { ok: true });
  } catch (err) {
    console.error(err);
    return json(500, { error: String(err?.message || err) });
  }
};
