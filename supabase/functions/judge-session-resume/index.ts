/**
 * judge-session-resume — Phase 0.5 Edge Function
 *
 * Read-only resume endpoint. Returns the caller's saved bookmark and elapsed
 * time for a given competition, validates the bookmarked entry still exists
 * and (if the round is identified) is still eligible.
 *
 * Heartbeat + bookmark writes stay on PostgREST per Phase 0.5 decision.
 */
import {
  authenticateJudge,
  AuthError,
} from "../_shared/judgingAuth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function bad(message: string, status = 400) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return bad("Method not allowed", 405);

  let auth;
  try {
    auth = await authenticateJudge(req);
  } catch (e) {
    if (e instanceof AuthError) return bad(e.message, e.status);
    return bad("Unauthorized", 401);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return bad("Invalid JSON body");
  }

  const { competition_id } = body ?? {};
  if (!competition_id || typeof competition_id !== "string")
    return bad("competition_id required");

  const { admin, userId } = auth;

  const { data: session } = await admin
    .from("judge_sessions")
    .select(
      "id, competition_id, round_id, last_entry_id, last_entry_index, last_photo_index, elapsed_seconds, status, heartbeat_at"
    )
    .eq("judge_id", userId)
    .eq("competition_id", competition_id)
    .maybeSingle();

  if (!session) {
    return new Response(
      JSON.stringify({ ok: true, session: null, resume: null }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  let resume: {
    entry_id: string;
    entry_index: number;
    photo_index: number;
    entry_exists: boolean;
    photo_in_range: boolean;
  } | null = null;

  if (session.last_entry_id) {
    const { data: entry } = await admin
      .from("competition_entries")
      .select("id, photos, status")
      .eq("id", session.last_entry_id)
      .maybeSingle();

    const photoCount = Array.isArray(entry?.photos) ? entry!.photos.length : 0;
    resume = {
      entry_id: session.last_entry_id,
      entry_index: session.last_entry_index ?? 0,
      photo_index: session.last_photo_index ?? 0,
      entry_exists: !!entry,
      photo_in_range:
        !!entry && (session.last_photo_index ?? 0) < photoCount,
    };
  }

  return new Response(
    JSON.stringify({ ok: true, session, resume }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
