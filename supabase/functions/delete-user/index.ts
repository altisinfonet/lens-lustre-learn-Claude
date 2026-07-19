import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Verify the caller is an admin
    const callerClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: caller } } = await callerClient.auth.getUser();
    if (!caller) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });

    const adminClient = createClient(supabaseUrl, serviceKey);
    const { data: adminRole } = await adminClient
      .from("user_roles")
      .select("role")
      .eq("user_id", caller.id)
      .eq("role", "admin")
      .maybeSingle();
    if (!adminRole) return new Response(JSON.stringify({ error: "Admin only" }), { status: 403, headers: corsHeaders });

    const { user_id } = await req.json();
    if (!user_id || typeof user_id !== "string") {
      return new Response(JSON.stringify({ error: "user_id required" }), { status: 400, headers: corsHeaders });
    }

    // Prevent self-deletion
    if (user_id === caller.id) {
      return new Response(JSON.stringify({ error: "Cannot delete yourself" }), { status: 400, headers: corsHeaders });
    }

    // Delete the auth user FIRST via a direct RPC. The GoTrue admin API
    // (auth.admin.deleteUser) fails on this project with an empty error, and doing
    // it last meant a failure destroyed all the user's data while leaving a
    // still-logged-in "ghost" account. Deleting auth.users first (a) is proven to
    // work, (b) cascades the FK-linked public tables, and (c) aborts cleanly on
    // failure BEFORE any data is touched. Then we clean up the non-FK-linked rows.
    const { data: authDeleted, error: authError } = await adminClient.rpc(
      "admin_delete_auth_user",
      { _uid: user_id },
    );
    if (authError) {
      console.error("admin_delete_auth_user error:", authError);
      return new Response(JSON.stringify({ error: "Failed to delete auth user: " + authError.message }), { status: 500, headers: corsHeaders });
    }
    if (authDeleted === false) {
      return new Response(JSON.stringify({ error: "User not found" }), { status: 404, headers: corsHeaders });
    }

    // Delete from all tables with user_id column
    const userIdTables = [
      "activity_logs", "bank_details", "certificate_testimonials", "certificates",
      "comment_reactions", "comments", "competition_entries", "competition_votes",
      "course_enrollments", "featured_photos", "gift_announcements", "highlights",
      "image_comments", "image_reactions", "lesson_progress", "post_comment_reactions",
      "post_comments", "post_reactions", "posts", "referral_codes", "role_applications",
      "stories", "support_tickets", "ticket_replies", "user_badges", "user_notifications",
      "user_roles", "verification_requests", "wallet_transactions", "wallets",
      "withdrawal_requests",
      // BUG-050: user-owned personal data / device tokens / queued content that
      // previously orphaned after deletion (privacy + scheduled-post ghost author).
      "user_devices", "scheduled_posts", "post_shares", "photo_albums",
      "notification_preferences", "newsletter_subscribers",
    ];

    for (const table of userIdTables) {
      await adminClient.from(table).delete().eq("user_id", user_id);
    }

    // Delete from tables with other user-referencing columns
    await adminClient.from("follows").delete().or(`follower_id.eq.${user_id},following_id.eq.${user_id}`);
    await adminClient.from("friendships").delete().or(`requester_id.eq.${user_id},addressee_id.eq.${user_id}`);
    await adminClient.from("profile_views").delete().or(`profile_id.eq.${user_id},viewer_id.eq.${user_id}`);
    await adminClient.from("referrals").delete().or(`referrer_id.eq.${user_id},referred_id.eq.${user_id}`);
    await adminClient.from("competition_judges").delete().eq("judge_id", user_id);
    await adminClient.from("judge_comments").delete().eq("judge_id", user_id);
    await adminClient.from("judge_scores").delete().eq("judge_id", user_id);
    await adminClient.from("judge_tag_assignments").delete().eq("judge_id", user_id);

    // BUG-050: user-owned rows keyed by non-user_id columns
    await adminClient.from("portfolio_images").delete().eq("uploaded_by", user_id);
    // Moderation reports FILED BY the user: reporter_id is NOT NULL, so remove the
    // report rows (reporter is gone) rather than orphan them.
    await adminClient.from("reports").delete().eq("reporter_id", user_id);
    await adminClient.from("comment_reports").delete().eq("reporter_id", user_id);
    await adminClient.from("post_reports").delete().eq("reporter_id", user_id);

    // Nullify references where we don't want to delete the parent record
    await adminClient.from("comment_reports").update({ reviewed_by: null }).eq("reviewed_by", user_id);
    await adminClient.from("post_reports").update({ reviewed_by: null }).eq("reviewed_by", user_id);
    await adminClient.from("role_applications").update({ reviewed_by: null }).eq("reviewed_by", user_id);
    await adminClient.from("verification_requests").update({ reviewed_by: null }).eq("reviewed_by", user_id);
    await adminClient.from("withdrawal_requests").update({ reviewed_by: null }).eq("reviewed_by", user_id);
    // BUG-050: anonymize the deleted user as an actor in other users' notifications
    await adminClient.from("user_notifications").update({ actor_id: null }).eq("actor_id", user_id);

    // BUG-111: purge the remaining user-referencing tables that were still orphaning
    // after BUG-050 (feed_events, ai_chat_usage, raw_commitments (PII), judge_* work +
    // decisions, held_result_notifications, notification_emit_log, ad_conversions,
    // auth_login_attempts, custom_url_history, post_tags) and strip the user from other
    // users' scheduled_posts.tagged_user_ids[]. Done atomically server-side; financial/
    // audit ledgers are intentionally preserved. Non-fatal: log and continue on error.
    {
      const { data: purge, error: purgeErr } = await adminClient.rpc(
        "admin_purge_orphan_user_data",
        { _uid: user_id },
      );
      if (purgeErr) {
        console.error("admin_purge_orphan_user_data error:", purgeErr);
      } else {
        console.log("Purged orphan user data:", JSON.stringify(purge));
      }
    }

    // profiles was already cascade-deleted by admin_delete_auth_user (profiles.id
    // -> auth.users is ON DELETE CASCADE); this is a defensive no-op.
    await adminClient.from("profiles").delete().eq("id", user_id);

    return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    console.error("Delete user error:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
  }
});
