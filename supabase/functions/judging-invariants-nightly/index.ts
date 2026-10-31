// Phase R3 — Nightly judging invariants cron
// -------------------------------------------
// Runs `judging_invariants_check()` against the live DB and:
//   - returns the full report in the response (admin-readable)
//   - writes one row per FAILING check to db_audit_logs so admins can see drift
//
// Triggered by pg_cron (configured separately via the insert tool).
// verify_jwt is false so the cron's anon-bearer call succeeds; access to the
// underlying RPC is enforced by service-role bypass + admin check inside SQL.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const cronSecret = req.headers.get("x-cron-secret");
  if (!cronSecret || cronSecret !== Deno.env.get("CRON_SECRET")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }



  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Service role bypasses RLS / admin guard inside the function.
    const { data, error } = await admin.rpc("judging_invariants_check");
    if (error) throw error;

    const rows = (data as any[]) ?? [];
    const failures = rows.filter((r) => r.status !== "ok");

    // Persist any failures so they surface in the admin health dashboard.
    if (failures.length > 0) {
      const detectedAt = new Date().toISOString();

      // 1) Forensic audit trail (kept for historical drift analysis).
      const auditRows = failures.map((f) => ({
        table_name: "judging_invariants",
        operation: "drift_detected",
        row_id: f.check_name,
        new_data: {
          check_name: f.check_name,
          fail_count: f.fail_count,
          sample: f.sample,
          detected_at: detectedAt,
        },
      }));
      await admin.from("db_audit_logs").insert(auditRows);

      // 2) SCREAM at admins via the bell icon (admin_notifications).
      // One row per failing check so each can be acknowledged independently.
      const notifRows = failures.map((f) => ({
        type: "judging_invariant_failure",
        title: `Judging invariant failed: ${f.check_name}`,
        message:
          `Nightly check "${f.check_name}" detected ${f.fail_count} drift row(s). ` +
          `Sample: ${JSON.stringify(f.sample).slice(0, 400)}`,
        is_read: false,
      }));
      await admin.from("admin_notifications").insert(notifRows);
    }

    return new Response(
      JSON.stringify({
        ok: failures.length === 0,
        checks: rows,
        failures,
        ran_at: new Date().toISOString(),
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: (e as Error).message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 },
    );
  }
});
