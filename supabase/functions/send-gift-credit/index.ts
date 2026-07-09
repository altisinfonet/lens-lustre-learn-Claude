import { createClient } from "https://esm.sh/@supabase/supabase-js@2.97.0";
import { getSecureHeaders } from "../_shared/secureHeaders.ts";

Deno.serve(async (req) => {
  const headers = getSecureHeaders(req);

  if (req.method === "OPTIONS") return new Response(null, { headers });
  if (req.method === "TRACE") return new Response("Method Not Allowed", { status: 405, headers });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    // Verify caller identity from JWT, not from request body
    const authHeader = req.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers });
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(authHeader.replace("Bearer ", ""));
    if (claimsError || !claimsData?.claims?.sub) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers });
    }
    const callerId = claimsData.claims.sub;

    // Use service role client for admin operations
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Check the actual caller is an admin
    const { data: adminRole } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", callerId)
      .eq("role", "admin")
      .maybeSingle();
    if (!adminRole) {
      return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers });
    }

    const body = await req.json();
    const { target_type, target_email, user_ids, amount, reason, gift_credit_id } = body;

    let resolvedUserIds: string[] = user_ids || [];

    if (target_type === "email" && target_email) {
      const { data: authUsers } = await supabase.auth.admin.listUsers();
      const matchedUser = authUsers?.users?.find(
        (u: any) => u.email?.toLowerCase() === target_email.toLowerCase()
      );

      if (!matchedUser) {
        return new Response(JSON.stringify({ error: "User with this email not found" }), { status: 404, headers });
      }

      resolvedUserIds = [matchedUser.id];

      const { data: gc, error: gcErr } = await supabase
        .from("gift_credits")
        .insert({ admin_id: callerId, amount, reason, target_type: "email", target_value: target_email, recipients_count: 1 })
        .select("id")
        .single();

      if (gcErr || !gc?.id) {
        console.error("Gift credit insert failed:", gcErr);
        return new Response(JSON.stringify({ error: `Failed to record gift: ${gcErr?.message ?? "unknown"}` }), { status: 500, headers });
      }

      // CRITICAL: credit the wallet FIRST. If this fails, do NOT insert the announcement.
      const { error: rpcErr } = await supabase.rpc("admin_wallet_credit", {
        _admin_id: callerId,
        _target_user_id: matchedUser.id,
        _amount: amount,
        _type: "gift",
        _description: reason,
        _reference_id: gc.id,
        _reference_type: "gift_credit",
      });

      if (rpcErr) {
        console.error("admin_wallet_credit RPC failed:", rpcErr);
        // Roll back the gift_credits row to keep state consistent (no orphan source).
        await supabase.from("gift_credits").delete().eq("id", gc.id);
        return new Response(
          JSON.stringify({ error: `Wallet credit failed: ${rpcErr.message}. Gift NOT delivered.` }),
          { status: 500, headers },
        );
      }

      const { error: annErr } = await supabase.from("gift_announcements").insert({
        user_id: matchedUser.id, gift_credit_id: gc.id, amount, reason,
      });
      if (annErr) {
        // Wallet was credited successfully — surface the announcement failure but don't fail the whole request.
        console.error("Gift announcement insert failed (wallet was credited):", annErr);
      }
    }

    if (resolvedUserIds.length > 0) {
      const { data: authUsers } = await supabase.auth.admin.listUsers();
      const emailMap = new Map(authUsers?.users?.map((u: any) => [u.id, u.email]) || []);
      const emails = resolvedUserIds.map((uid) => emailMap.get(uid)).filter(Boolean);
      console.log(`Gift notification emails would be sent to: ${emails.join(", ")}`);
      console.log(`Amount: $${amount}, Reason: ${reason}`);
    }

    return new Response(JSON.stringify({ success: true, recipients: resolvedUserIds.length }), { headers });
  } catch (err: any) {
    console.error("Gift credit error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), { status: 500, headers });
  }
});
