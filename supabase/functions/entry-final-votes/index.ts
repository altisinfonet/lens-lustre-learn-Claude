/**
 * entry-final-votes
 * ------------------------------------------------------------------
 * Returns authoritative final vote totals for a list of entry IDs.
 *
 *   â¢ Entry-level total  = real_votes + adjustment_total  (from entry_final_votes view)
 *   â¢ Per-photo total    = COUNT(competition_votes per photo) + SUM(admin_vote_adjustments per photo)
 *
 * SECURITY:
 *   â¢ Uses the service-role client server-side ONLY.
 *   â¢ Returns nothing besides aggregated counts â no admin_id, no reason,
 *     no per-vote rows. The raw audit trail in admin_vote_adjustments
 *     remains admin-only at the DB (RLS).
 *
 * INPUT  : { entry_ids: string[] }   (max 200)
 * OUTPUT : {
 *   totals: Record<entry_id, number>,                          // final total per entry
 *   per_photo: Record<entry_id, Record<photo_index, number>>,  // final total per photo
 * }
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.8";
import { getSecureHeaders } from "../_shared/secureHeaders.ts";

const MAX_ENTRY_IDS = 200;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  const headers = getSecureHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers });

  try {
    // SECURITY (entry_final_votes_unauth): require an authenticated caller.
    // The competition_votes table is RLS-gated by is_vote_phase_locked during
    // active phases; this edge fn served aggregates unauthenticated. Now
    // rejects anonymous callers and validates the JWT via getClaims().
    const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers });
    }
    const anonClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: claimsData, error: claimsErr } = await anonClient.auth.getClaims(
      authHeader.replace("Bearer ", ""),
    );
    if (claimsErr || !claimsData?.claims?.sub) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers });
    }

    let entryIds: string[] = [];
    try {
      const body = await req.json();
      if (Array.isArray(body?.entry_ids)) {
        entryIds = body.entry_ids
          .filter((x: unknown): x is string => typeof x === "string" && UUID_RE.test(x))
          .slice(0, MAX_ENTRY_IDS);
      }
    } catch {
      // ignore â empty input handled below
    }

    if (entryIds.length === 0) {
      return new Response(JSON.stringify({ totals: {}, per_photo: {} }), {
        status: 200,
        headers,
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    // PHOTO-GRAIN authoritative view (Phase 1): one row per (entry_id, photo_index).
    // Single source of truth â no client-side or duplicate aggregation.
    const { data: photoRows, error: viewErr } = await admin
      .from("entry_final_votes" as any)
      .select("entry_id, photo_index, final_votes")
      .in("entry_id", entryIds);

    if (viewErr) throw viewErr;

    const totals: Record<string, number> = {};
    const perPhoto: Record<string, Record<number, number>> = {};
    ((photoRows as any[] | null) ?? []).forEach((r: any) => {
      const eid = String(r.entry_id);
      const pi = typeof r.photo_index === "number" ? r.photo_index : 0;
      const fv = Math.max(0, Number(r.final_votes ?? 0));
      totals[eid] = (totals[eid] || 0) + fv;
      if (!perPhoto[eid]) perPhoto[eid] = {};
      perPhoto[eid][pi] = fv;
    });

    return new Response(JSON.stringify({ totals, per_photo: perPhoto }), {
      status: 200,
      headers,
    });
  } catch (err) {
    console.error("entry-final-votes error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers,
    });
  }
});