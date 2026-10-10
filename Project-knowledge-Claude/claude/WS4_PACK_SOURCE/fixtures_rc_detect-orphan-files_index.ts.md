// RC SHAPE FIXTURE — real specifiers from a42b209e, body elided. See 09_rc_regression.sh header.
// Real file: 597 lines, 26896 bytes.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";
import {
  listBucket,
  headObject,
} from "../_shared/s3.ts";
import { referenceSet } from "../_shared/referenceSet.ts";

/* body elided */
export default async function handler(_req: Request): Promise<Response> {
  const c = createClient("", "");
  return new Response(String([c, listBucket, headObject, referenceSet].length));
}
