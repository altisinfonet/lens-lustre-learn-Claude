import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * SELF-SERVE ACCOUNT DELETION.
 *
 * Lets a signed-in user permanently delete THEIR OWN account and all associated
 * data. This is the user-facing counterpart to the admin-only `delete-user`
 * function and runs the exact same deletion cascade — but it can ONLY ever act
 * on the caller's own id (never a target passed in the body), so a user can
 * never delete anyone else.
 *
 * Required for Google Play / Apple "delete account" policy and general privacy.
 *
 * Admins are blocked here (returned to support) so the platform can never be
 * accidentally locked out by an owner deleting themselves. Everyone else may
 * delete freely.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Identify the caller from their JWT. The id we delete is ALWAYS caller.id.
    const callerClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: caller } } = await callerClient.auth.getUser();
    if (!caller) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const user_id = caller.id; // self only — never taken from the request body

    const adminClient = createClient(supabaseUrl, serviceKey);

    // Capture what we need for the post-deletion erasure-confirmation email
    // BEFORE anything is deleted (profiles cascades away with auth.users).
    const notifyEmail: string | null = caller.email ?? null;
    let notifyName: string | null = null;
    {
      const { data: prof } = await adminClient
        .from("profiles")
        .select("full_name")
        .eq("id", user_id)
        .maybeSingle();
      notifyName = (prof as any)?.full_name ?? null;
    }

    // Safety: admins cannot self-delete through this path (prevents locking the
    // whole platform out). They must be removed by another admin / support.
    const { data: adminRole } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", user_id)
      .eq("role", "admin")
      .maybeSingle();
    if (adminRole) {
      return new Response(
        JSON.stringify({ error: "Admin accounts cannot be self-deleted. Please contact support." }),
        { status: 403, headers: corsHeaders },
      );
    }

    // Delete the auth user FIRST (proven to work on this project; cascades the
    // FK-linked public tables and aborts cleanly on failure BEFORE any data is
    // touched). Mirrors the admin `delete-user` ordering exactly.
    const { data: authDeleted, error: authError } = await adminClient.rpc(
      "admin_delete_auth_user",
      { _uid: user_id },
    );
    if (authError) {
      console.error("admin_delete_auth_user error:", authError);
      return new Response(
        JSON.stringify({ error: "Failed to delete account: " + authError.message }),
        { status: 500, headers: corsHeaders },
      );
    }
    if (authDeleted === false) {
      return new Response(JSON.stringify({ error: "Account not found" }), { status: 404, headers: corsHeaders });
    }

    // Delete from all tables with a user_id column (identical set to delete-user).
    const userIdTables = [
      "activity_logs", "bank_details", "certificate_testimonials", "certificates",
      "comment_reactions", "comments", "competition_entries", "competition_votes",
      "course_enrollments", "featured_photos", "gift_announcements", "highlights",
      "image_comments", "image_reactions", "lesson_progress", "post_comment_reactions",
      "post_comments", "post_reactions", "posts", "referral_codes", "role_applications",
      "stories", "support_tickets", "ticket_replies", "user_badges", "user_notifications",
      "user_roles", "verification_requests", "wallet_transactions", "wallets",
      "withdrawal_requests",
      "user_devices", "scheduled_posts", "post_shares", "photo_albums",
      "notification_preferences", "newsletter_subscribers",
    ];
    // PERF: run deletes in parallel batches instead of ~50 sequential
    // round-trips (which made deletion take 15-30s and feel hung).
    const chunk = <T,>(arr: T[], n: number): T[][] =>
      Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
    for (const batch of chunk(userIdTables, 10)) {
      await Promise.all(batch.map((table) => adminClient.from(table).delete().eq("user_id", user_id)));
    }

    // Tables that reference the user via other columns — parallel.
    await Promise.all([
      adminClient.from("follows").delete().or(`follower_id.eq.${user_id},following_id.eq.${user_id}`),
      adminClient.from("friendships").delete().or(`requester_id.eq.${user_id},addressee_id.eq.${user_id}`),
      adminClient.from("profile_views").delete().or(`profile_id.eq.${user_id},viewer_id.eq.${user_id}`),
      adminClient.from("referrals").delete().or(`referrer_id.eq.${user_id},referred_id.eq.${user_id}`),
      adminClient.from("competition_judges").delete().eq("judge_id", user_id),
      adminClient.from("judge_comments").delete().eq("judge_id", user_id),
      adminClient.from("judge_scores").delete().eq("judge_id", user_id),
      adminClient.from("judge_tag_assignments").delete().eq("judge_id", user_id),
      adminClient.from("portfolio_images").delete().eq("uploaded_by", user_id),
      adminClient.from("reports").delete().eq("reporter_id", user_id),
      adminClient.from("comment_reports").delete().eq("reporter_id", user_id),
      adminClient.from("post_reports").delete().eq("reporter_id", user_id),
    ]);

    // Nullify references where the parent record must survive — parallel.
    await Promise.all([
      adminClient.from("comment_reports").update({ reviewed_by: null }).eq("reviewed_by", user_id),
      adminClient.from("post_reports").update({ reviewed_by: null }).eq("reviewed_by", user_id),
      adminClient.from("role_applications").update({ reviewed_by: null }).eq("reviewed_by", user_id),
      adminClient.from("verification_requests").update({ reviewed_by: null }).eq("reviewed_by", user_id),
      adminClient.from("withdrawal_requests").update({ reviewed_by: null }).eq("reviewed_by", user_id),
    ]);

      // ── actor_id is deliberately NOT nulled here. ──────────────────────────
      // Owner chose option C on 2026-08-10: keep the id, let the profile go,
      // and let the display say "A deleted account".
      //
      // Nulling it looked like anonymisation and was not. The row's
      // reference_id still pointed at the same person, so the identity was
      // recoverable anyway — while the bell lost the ONE fact it needed and
      // read "A member started following you", which is the wording for a
      // present member who has set no name. Two different facts, one sentence.
      // Thirty-five live rows were in that state.
      //
      // Verified on production before this line was removed, because the whole
      // change is pointless if something else nulls it anyway:
      //   * user_notifications has ZERO foreign keys, so no ON DELETE SET NULL
      //     and no constraint that could block the profile being deleted;
      //   * no database function sets actor_id — admin_purge_orphan_user_data,
      //     the only purge routine, does not touch it.
      // These two edge functions were the only thing doing it.
      //
      // THE PROFILE BEING GONE IS THE ANONYMISATION. No name, no avatar, and
      // nothing revealed that reference_id did not already carry.


    // Server-side purge of the remaining user-referencing rows (feed_events,
    // raw_commitments PII, judge decisions, notification logs, post_tags, and the
    // user's id inside other users' scheduled_posts.tagged_user_ids[]). Financial
    // / audit ledgers are intentionally preserved for legal compliance.
    {
      const { error: purgeErr } = await adminClient.rpc("admin_purge_orphan_user_data", { _uid: user_id });
      if (purgeErr) console.error("admin_purge_orphan_user_data error:", purgeErr);
    }

    // Defensive: profiles cascades from auth.users, but ensure it's gone.
    await adminClient.from("profiles").delete().eq("id", user_id);

    // Erasure-confirmation notice: after the deletion has fully completed, send
    // the (former) account email a written confirmation that the account and
    // its personal data were deleted. Sent via the standard transactional
    // pipeline so it is rendered, queued, retried and logged (email_send_log is
    // our proof the notice was issued). A failure here must NEVER fail the
    // deletion itself — the deletion already happened.
    let confirmationQueued = false;
    if (notifyEmail) {
      try {
        const res = await fetch(`${supabaseUrl}/functions/v1/send-transactional-email`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${serviceKey}`,
          },
          body: JSON.stringify({
            templateName: "account-deleted",
            recipientEmail: notifyEmail,
            idempotencyKey: `account-deleted-${user_id}`,
            templateData: {
              fullName: notifyName,
              deletedAt: new Date().toISOString(),
            },
          }),
        });
        confirmationQueued = res.ok;
        if (!res.ok) {
          console.error("account-deleted email enqueue failed:", res.status, await res.text());
        }
      } catch (mailErr) {
        console.error("account-deleted email error:", mailErr);
      }
    } else {
      console.error("account-deleted email skipped: caller had no email on JWT", { user_id });
    }

    return new Response(JSON.stringify({ success: true, confirmation_email_queued: confirmationQueued }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("delete-my-account error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500, headers: corsHeaders });
  }
});
