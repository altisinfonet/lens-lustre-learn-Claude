// RC SHAPE FIXTURE — real specifiers from a42b209e, body elided. See 09_rc_regression.sh header.
// Real file: 339 lines, 14079 bytes.
import {
  secureHeaders,
  corsHeaders,
} from "../_shared/secureHeaders.ts";
import { requireJudge } from "../_shared/judgingAuth.ts";

/* body elided — not required for specifier extraction */
export default async function handler(_req: Request): Promise<Response> {
  return new Response("elided", { headers: secureHeaders(requireJudge) });
}
