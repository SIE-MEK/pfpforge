import { init, sessionEmail, isActiveEmail, json } from "../../lib/auth.mjs";

/* The site calls this on load with the saved session token. It re-checks the
   live entitlement (so a cancellation revokes access even before the token
   expires). Returns { pro: true|false }. */

export const handler = async (event) => {
  init(event);
  const email = sessionEmail(event);
  if (!email) return json(200, { pro: false });
  const active = await isActiveEmail(email);
  return json(200, { pro: active, email });
};
