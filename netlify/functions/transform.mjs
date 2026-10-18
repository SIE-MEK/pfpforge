import { fal } from "@fal-ai/client";
import { sessionEmail, isActiveEmail, hit, readJSON, json } from "../../lib/auth.mjs";

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

   Optional env vars:
     AI_ENABLED=false       server-side kill switch: stops all AI spend
     DAILY_AI_LIMIT=30      AI transforms per subscriber per UTC day
     FUNCTION_TIMEOUT_S=10  your Netlify function timeout (raise if Netlify
                            raised yours, e.g. 26)
--------------------------------------------------------------------------- */
const MODEL = "fal-ai/nano-banana-2/edit";
const MAX_IMAGE_CHARS = 3_000_000;   // ~2.2 MB image; the client sends a 640px JPEG
const MAX_PROMPT_CHARS = 1000;
const DAY = 24 * 60 * 60 * 1000;

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "POST only" });
  if (process.env.AI_ENABLED === "false") return json(503, { error: "AI mode is temporarily off" });

  // SPEND GATE: only an active, verified subscriber can trigger a paid AI call.
  // This is enforced on the server so it can't be bypassed from the browser.
  const email = sessionEmail(req);
  if (!email) return json(401, { error: "Sign in / subscribe to use AI mode" });
  if (!(await isActiveEmail(email))) return json(403, { error: "No active Pro subscription" });
  if (!process.env.FAL_KEY) return json(500, { error: "AI is not configured on the server" });

  const { prompt, image } = await readJSON(req);
  if (typeof prompt !== "string" || !prompt.trim() || prompt.length > MAX_PROMPT_CHARS) {
    return json(400, { error: "A prompt of up to 1000 characters is required" });
  }
  if (typeof image !== "string" || !/^data:image\/(jpeg|png|webp);base64,/.test(image) || image.length > MAX_IMAGE_CHARS) {
    return json(400, { error: "image must be a JPEG, PNG or WebP data URI under 2 MB" });
  }

  // Count the attempt before spending, so failed or timed-out calls count too.
  const limit = Number(process.env.DAILY_AI_LIMIT) || 30;
  if (!(await hit("ai", email, limit, DAY))) {
    return json(429, { error: `Daily AI limit reached (${limit}). It resets at midnight UTC.` });
  }

  // Stop waiting before Netlify kills the function, so the browser gets a
  // clean 504 instead of a crash. We also ask fal to cancel; that only saves
  // money if the job hasn't started yet (fal can't stop a running job).
  const budgetMs = (Number(process.env.FUNCTION_TIMEOUT_S) || 10) * 1000 - 2500;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), Math.max(budgetMs, 3000));
  let requestId = null;

  try {
    fal.config({ credentials: process.env.FAL_KEY });

    // fal accepts a base64 data URI directly as an image input.
    const result = await fal.subscribe(MODEL, {
      input: { prompt, image_urls: [image] },
      abortSignal: ctl.signal,
      onEnqueue: id => { requestId = id; }
    });

    const outUrl = result?.data?.images?.[0]?.url;
    if (!outUrl) return json(502, { error: "Model returned no image" });

    // Fetch the result server-side and hand the browser base64, so the
    // <canvas> stays "clean" and the Download button keeps working.
    const imgRes = await fetch(outUrl, { signal: ctl.signal });
    const type = imgRes.headers.get("content-type") || "";
    if (!imgRes.ok || !type.startsWith("image/")) return json(502, { error: "Could not fetch the generated image" });
    const buf = Buffer.from(await imgRes.arrayBuffer());

    return json(200, { image: `data:${type.split(";")[0]};base64,${buf.toString("base64")}` });
  } catch (err) {
    if (ctl.signal.aborted) {
      if (requestId) {
        // Awaited (briefly): after we return, Netlify may freeze the process.
        await Promise.race([fal.queue.cancel(MODEL, { requestId }).catch(() => {}), new Promise(r => setTimeout(r, 1000))]);
      }
      return json(504, { error: "The AI took too long. Please try again." });
    }
    console.error(err);
    return json(500, { error: "AI transform failed" });
  } finally {
    clearTimeout(timer);
  }
};
