import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getSecureHeaders } from "../_shared/secureHeaders.ts";

/**
 * Phase 1 Mutation #3 — Model A (debit-at-request).
 *
 * Approve path: status update + audit ONLY. No wallet debit (debit already
 *   occurred at request time via public.request_withdrawal RPC).
 * Reject path: status update + idempotent withdrawal_refund (+amount).
 *   Idempotency: reference_id=withdrawal_id AND reference_type='withdrawal_refund'.
 */
Deno.serve(async (req) => {
  const headers = getSecureHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers });

  try {
    const authHeader = req.headers.get("authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: { user }, error: authError } = await admin.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), { status: 401, headers });
    }

    const { data: roleData } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();

    if (!roleData) {
      return new Response(JSON.stringify({ error: "Admin access required" }), { status: 403, headers });
    }

    const body = await req.json();
    const { withdrawal_id, status, admin_note } = body;

    if (!withdrawal_id || !status || !["approved", "rejected"].includes(status)) {
      return new Response(JSON.stringify({ error: "Invalid parameters" }), { status: 400, headers });
    }

    const { data: withdrawal, error: fetchError } = await admin
      .from("withdrawal_requests")
      .select("id, user_id, amount, status")
      .eq("id", withdrawal_id)
      .single();

    if (fetchError || !withdrawal) {
      return new Response(JSON.stringify({ error: "Withdrawal not found" }), { status: 404, headers });
    }

    if (withdrawal.status !== "pending") {
      return new Response(JSON.stringify({ error: "Withdrawal is not pending" }), { status: 400, headers });
    }

    // REJECT: idempotent refund (debit at request time must be reversed)
    if (status === "rejected") {
      const { data: existingRefund } = await admin
        .from("wallet_transactions")
        .select("id")
        .eq("reference_id", withdrawal_id)
        .eq("reference_type", "withdrawal_refund")
        .limit(1)
        .maybeSingle();

      if (!existingRefund) {
        const { error: refundError } = await admin.rpc("wallet_transaction", {
          _user_id: withdrawal.user_id,
          _type: "withdrawal_refund",
          _amount: Number(withdrawal.amount),
          _description: `Withdrawal rejected — refund $${withdrawal.amount}`,
          _reference_id: withdrawal_id,
          _reference_type: "withdrawal_refund",
        });
        if (refundError) {
          return new Response(JSON.stringify({
            error: `Refund failed: ${refundError.message}. Withdrawal NOT rejected.`
          }), { status: 400, headers });
        }
      }
    }
    // APPROVE: no wallet movement — debit already occurred at request time.

    const { error: updateError } = await admin
      .from("withdrawal_requests")
      .update({
        status,
        admin_note: admin_note || null,
        reviewed_by: user.id,
        updated_at: new Date().toISOString(),
      })
      .eq("id", withdrawal_id);

    if (updateError) {
      return new Response(JSON.stringify({ error: `Status update failed: ${updateError.message}` }), { status: 500, headers });
    }

    await admin.from("db_audit_logs").insert({
      table_name: "withdrawal_requests",
      operation: "UPDATE",
      row_id: withdrawal_id,
      old_data: { status: "pending" },
      new_data: { status, admin_note, reviewed_by: user.id },
      changed_by: user.id,
    });

    return new Response(JSON.stringify({
      success: true,
      message: `Withdrawal ${status}`,
      amount: withdrawal.amount,
      user_id: withdrawal.user_id,
    }), { status: 200, headers });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
});
