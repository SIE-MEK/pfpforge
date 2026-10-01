import { fal } from "@fal-ai/client";
import { bearer, verify, isActiveEmail } from "../../lib/auth.mjs";

/* ---------------------------------------------------------------------------
   PFPFORGE — AI transform proxy (Netlify Function)
   Keeps your fal.ai API key SECRET on the server. The browser never sees it.
   The frontend POSTs { prompt, image(dataURI) } and gets back { image(base64) }.

   MODEL: a FAST, identity-preserving image-edit endpoint on fal.ai.
   Default is Nano Banana 2 (Gemini 3.1 Flash Image) — "4x faster, lower cost,"
   keeps faces recognizable, and finishes well within Netlify's timeout.
   Swap for another model from https://fal.ai/models if you like:
     - "fal-ai/nano-banana-2/edit"        (default — fast, prompt + image_urls)
     - "fal-ai/firered-image-edit-v1.1"   (strong identity/portrait consistency)
     - "openai/gpt-image-2/edit"          (prompt + image_urls, slower)
     - "fal-ai/flux/dev/image-to-image"   (uses { image_url, strength } instead)
--------------------------------------------------------------------------- */
const MODEL = "fal-ai/nano-banana-2/edit";

export const handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "POST only" });
  if (!process.env.FAL_KEY)        return json(500, { error: "FAL_KEY env var is not set on the server" });

  // SPEND GATE: only an active, verified subscriber can trigger a paid AI call.
  // This is enforced on the server so it can't be bypassed from the browser.
  const payload = verify(bearer(event) || "");
  if (!payload?.email || payload.typ === "login") return json(401, { error: "Sign in / subscribe to use AI mode" });
  if (!(await isActiveEmail(payload.email)))      return json(403, { error: "No active Pro subscription" });

  try {
    const { prompt, image } = JSON.parse(event.body || "{}");
    if (!prompt || !image) return json(400, { error: "Both 'prompt' and 'image' are required" });

    fal.config({ credentials: process.env.FAL_KEY });

    // fal accepts a base64 data URI directly as an image input.
    const result = await fal.subscribe(MODEL, {
      input: { prompt, image_urls: [image] }
    });

    const outUrl = result?.data?.images?.[0]?.url;
    if (!outUrl) return json(502, { error: "Model returned no image" });

    // Fetch the result server-side and hand the browser base64, so the
    // <canvas> stays "clean" and the Download button keeps working.
    const imgRes = await fetch(outUrl);
    const buf = Buffer.from(await imgRes.arrayBuffer());
    const b64 = `data:image/png;base64,${buf.toString("base64")}`;

    return json(200, { image: b64 });
  } catch (err) {
    console.error(err);
    return json(500, { error: String(err?.message || err) });
  }
};

function json(statusCode, obj) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(obj)
  };
}
