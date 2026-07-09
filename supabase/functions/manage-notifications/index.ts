import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getSecureHeaders } from "../_shared/secureHeaders.ts";

Deno.serve(async (req) => {
  const headers = getSecureHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response(null, { headers });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const token = authHeader.replace("Bearer ", "");
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
  if (claimsError || !claimsData?.claims) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers });
  }

  const userId = claimsData.claims.sub;

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid request body" }), { status: 400, headers });
  }

  const { action } = body;

  try {
    if (action === "dismiss_user") {
      const { error } = await supabase
        .from("user_notifications")
        .update({ is_read: true })
        .eq("id", body.id)
        .eq("user_id", userId);
      if (error) throw error;

    } else if (action === "dismiss_admin") {
      // Verify caller is admin
      const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
      if (!isAdmin) {
        return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers });
      }
      const { error } = await supabase
        .from("admin_notifications")
        .update({ is_read: true })
        .eq("id", body.id);
      if (error) throw error;

    } else if (action === "dismiss_gift") {
      const { error } = await supabase
        .from("gift_announcements")
        .update({ is_read: true })
        .eq("id", body.id)
        .eq("user_id", userId);
      if (error) throw error;

    } else if (action === "mark_all_read") {
      await supabase
        .from("user_notifications")
        .update({ is_read: true })
        .eq("user_id", userId)
        .eq("is_read", false);
      await supabase
        .from("gift_announcements")
        .update({ is_read: true })
        .eq("user_id", userId)
        .eq("is_read", false);

      if (body.includeAdmin) {
        const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
        if (isAdmin) {
          await supabase
            .from("admin_notifications")
            .update({ is_read: true })
            .eq("is_read", false);
        }
      }

    } else if (action === "insert_user_notification") {
      // Admin-only: insert notification for another user
      const { data: isAdmin } = await supabase.rpc("has_role", { _user_id: userId, _role: "admin" });
      if (!isAdmin) {
        return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403, headers });
      }
      const { error } = await supabase.from("user_notifications").insert({
        user_id: body.targetUserId,
        type: body.type,
        title: body.title,
        message: body.message,
      });
      if (error) throw error;

    } else if (action === "insert_admin_notification") {
      // Any authenticated user can trigger admin notifications (e.g. deposit requests)
      const { error } = await supabase.from("admin_notifications").insert({
        type: body.type,
        title: body.title,
        message: body.message,
        reference_id: body.referenceId ?? null,
      });
      if (error) throw error;

    } else {
      return new Response(JSON.stringify({ error: "Unknown action" }), { status: 400, headers });
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message ?? "Internal server error" }), {
      status: 500,
      headers: { ...headers, "Content-Type": "application/json" },
    });
  }
});
