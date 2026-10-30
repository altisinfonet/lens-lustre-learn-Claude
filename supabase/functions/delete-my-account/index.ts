import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { deleteMemberAccount } from "../_shared/accountDeletion.ts";
import { extractPath } from "../_shared/referenceSet.ts";
import { deleteS3Objects, getS3Settings, storageKeyWithPrefix } from "../_shared/s3.ts";

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

    // ── Foundation fix U2 (2026-10-30): ALL OR NOTHING, THEN THE FILES. ──────
    // One database call deletes every personal row and the login LAST in a
    // single transaction (delete_member_account). If anything fails, nothing
    // is deleted, the member is still signed in, and we tell them to retry —
    // the old code deleted the login first and ignored ~40 delete errors.
    // The member's own files (none that another row still uses) are queued in
    // the same transaction and removed here from Supabase Storage and S3/CDN;
    // a file that fails stays queued for the next drain.
    // Payment / ledger rows are kept with the member's identity removed (see
    // the migration header for the list and the reason).
    const s3 = await getS3Settings(adminClient).catch(() => null);
    const outcome = await deleteMemberAccount(user_id, {
      rpc: async (fn, args) => {
        const { data, error } = await adminClient.rpc(fn, args);
        return { data, error };
      },
      removeFromStorage: async (bucket, paths) => {
        const { error } = await adminClient.storage.from(bucket).remove(paths);
        return { error };
      },
      deleteFromS3: s3 && s3.enabled
        ? async (paths) => {
          const keys = paths.map((p) => storageKeyWithPrefix(s3.path_prefix, p)).filter((k): k is string => !!k);
          await deleteS3Objects(s3, keys);
        }
        : null,
      extractPath,
    });
    if (!outcome.ok) {
      console.error("delete_member_account failed:", outcome.error);
      return new Response(JSON.stringify({ error: outcome.error, retry: outcome.retry }), {
        status: outcome.status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (outcome.filesPending > 0) {
      console.error("account deleted; files still queued for removal:", outcome.filesPending);
    }

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

    return new Response(JSON.stringify({
      success: true,
      confirmation_email_queued: confirmationQueued,
      files_deleted: outcome.filesDeleted,
      files_pending: outcome.filesPending,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("delete-my-account error:", err);
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500, headers: corsHeaders });
  }
});
