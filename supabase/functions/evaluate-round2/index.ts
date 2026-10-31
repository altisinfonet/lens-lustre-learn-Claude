/**
 * evaluate-round2 — Judging v5 NEUTRALIZED SHIM
 *
 * In Judging v5, all decision-making flows through admin-defined tag clicks
 * which write directly to `judge_tag_assignments`. This edge function — which
 * formerly accepted "shortlist"/"skip" votes and auto-flipped entry status
 * via consensus — is no longer the decision path.
 *
 * It returns 410 Gone with a structured payload so any stale caller (mobile
 * cache, old browser tab) gets a clear error instead of a silent success.
 *
 * Round 2 progression is now driven exclusively by:
 *   1. Judges clicking admin-defined tags (e.g. "Qualified for Round 3")
 *   2. Admin running `complete-round` to aggregate + advance the round
 *   3. Admin clicking Publish on the round to reveal results to photographers
 */
import { getSecureHeaders } from "../_shared/secureHeaders.ts";

Deno.serve(async (req) => {
  const corsHeaders = getSecureHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  return new Response(
    JSON.stringify({
      ok: false,
      error: "evaluate-round2 is deprecated in Judging v5",
      detail:
        "All Round 2 decisions now flow through admin-defined tag clicks " +
        "(judge_tag_assignments). This endpoint no longer accepts writes.",
      migration: {
        write_path: "supabase.from('judge_tag_assignments').upsert(...)",
        publish_path: "edge function: publish-round",
      },
    }),
    {
      status: 410,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }
  );
});
