// Daily cron: scans for inactive users and sends a tone-rotating "We miss
// you" email on an escalating schedule. Soft cap = 7 sends at days
// 3, 7, 15, 30, 40, 50, 60 — then stops for good.
// Honors notification_preferences.email_reengagement opt-out + suppressed_emails.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.97.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

// Days of inactivity at which each successive email fires (step 1..N).
const SCHEDULE_DAYS = [3, 7, 15, 30, 40, 50, 60];
const MAX_SENDS = SCHEDULE_DAYS.length;       // 7
const FIRST_DAY = SCHEDULE_DAYS[0];           // 3 — eligibility threshold
// Minimum days between two consecutive sends to the same user. The tightest
// real gap in the ladder is 3→7 (4 days); this also throttles any pre-existing
// long-dormant user so they walk the ladder rather than getting flooded.
const MIN_GAP_DAYS = 4;
const TEMPLATE_BY_STEP: Record<number, string> = {
  1: "reengagement-day-3",   // poetic
  2: "reengagement-day-7",   // playful
  3: "reengagement-day-15",  // warm direct
  4: "reengagement-day-30",  // one-month digest
  5: "reengagement-day-40",  // one-photo nudge
  6: "reengagement-day-50",  // reassurance
  7: "reengagement-day-60",  // final farewell
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  // Allow either cron secret (server) or service-role JWT (manual admin trigger)
  const cronSecret = req.headers.get("x-cron-secret");
  const expectedCron = Deno.env.get("CRON_SECRET");
  const authHeader = req.headers.get("authorization") ?? "";
  const isCronAuthed = !!(expectedCron && cronSecret === expectedCron);
  const isServiceAuthed = authHeader.includes(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "___unset___");
  if (!isCronAuthed && !isServiceAuthed) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...CORS, "Content-Type": "application/json" } });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const now = new Date();
  const nowMs = now.getTime();

  // 1) Fetch candidates: inactive at least FIRST_DAY days, under the cap
  const firstThreshold = new Date(nowMs - FIRST_DAY * 86400_000).toISOString();
  const { data: candidates, error: cErr } = await supabase
    .from("profiles")
    .select("id, full_name, last_active_at, reengagement_sends_count, last_reengagement_sent_at, status")
    .lt("last_active_at", firstThreshold)
    .lt("reengagement_sends_count", MAX_SENDS)
    .neq("status", "suspended")
    .limit(500);

  if (cErr) {
    console.error("[reengagement] candidate fetch failed:", cErr.message);
    return new Response(JSON.stringify({ error: cErr.message }), { status: 500, headers: { ...CORS, "Content-Type": "application/json" } });
  }

  const results = { scanned: candidates?.length ?? 0, sent: 0, skipped: 0, errors: 0, details: [] as any[] };

  for (const p of candidates ?? []) {
    try {
      const lastActiveMs = p.last_active_at ? new Date(p.last_active_at).getTime() : 0;
      const daysInactive = Math.floor((nowMs - lastActiveMs) / 86400_000);
      const nextStep = (p.reengagement_sends_count ?? 0) + 1;
      // Safety: never index past the ladder (candidate query already caps this).
      if (nextStep > MAX_SENDS) { results.skipped++; continue; }
      const requiredDays = SCHEDULE_DAYS[nextStep - 1];

      // Gate: not yet due for next step
      if (daysInactive < requiredDays) { results.skipped++; continue; }

      // Gate: throttle — at least MIN_GAP_DAYS since last send
      if (p.last_reengagement_sent_at) {
        const sinceLast = (nowMs - new Date(p.last_reengagement_sent_at).getTime()) / 86400_000;
        if (sinceLast < MIN_GAP_DAYS - 0.5) { results.skipped++; continue; }
      }

      // Get email + preferences
      const { data: userInfo } = await supabase.auth.admin.getUserById(p.id);
      const email = userInfo?.user?.email;
      if (!email) { results.skipped++; continue; }

      const { data: prefs } = await supabase
        .from("notification_preferences")
        .select("email_reengagement")
        .eq("user_id", p.id)
        .maybeSingle();
      if (prefs && prefs.email_reengagement === false) { results.skipped++; continue; }

      const { data: suppressed } = await supabase
        .from("suppressed_emails")
        .select("email")
        .eq("email", email.toLowerCase())
        .maybeSingle();
      if (suppressed) { results.skipped++; continue; }

      // Gather dynamic stats (best-effort, non-blocking on individual failure)
      const sinceIso = p.last_active_at ?? new Date(nowMs - 30 * 86400_000).toISOString();
      const [{ count: newPostsCount }, { count: activeCompetitions }, { count: friendsActive }] = await Promise.all([
        supabase.from("posts").select("id", { count: "exact", head: true }).gte("created_at", sinceIso),
        supabase.from("competitions").select("id", { count: "exact", head: true }).eq("status", "open"),
        supabase.from("profiles").select("id", { count: "exact", head: true })
          .gte("last_active_at", new Date(nowMs - 86400_000).toISOString()),
      ]);

      const templateName = TEMPLATE_BY_STEP[nextStep];
      const idempotencyKey = `reengage-${p.id}-step${nextStep}`;

      const sendRes = await supabase.functions.invoke("send-transactional-email", {
        body: {
          templateName,
          recipientEmail: email,
          idempotencyKey,
          templateData: {
            participantName: p.full_name?.split(" ")[0] ?? null,
            newPostsCount: newPostsCount ?? 0,
            activeCompetitions: activeCompetitions ?? 0,
            friendsActive: friendsActive ?? 0,
          },
        },
      });

      if (sendRes.error) {
        console.error(`[reengagement] send failed for ${p.id}:`, sendRes.error.message);
        results.errors++;
        results.details.push({ user_id: p.id, step: nextStep, error: sendRes.error.message });
        continue;
      }

      // Mark sent
      await supabase
        .from("profiles")
        .update({
          reengagement_sends_count: nextStep,
          last_reengagement_sent_at: now.toISOString(),
        })
        .eq("id", p.id);

      results.sent++;
      results.details.push({ user_id: p.id, step: nextStep, template: templateName });
    } catch (e) {
      console.error("[reengagement] loop error:", (e as Error).message);
      results.errors++;
    }
  }

  return new Response(JSON.stringify({ success: true, ...results }), {
    headers: { ...CORS, "Content-Type": "application/json" },
  });
});
