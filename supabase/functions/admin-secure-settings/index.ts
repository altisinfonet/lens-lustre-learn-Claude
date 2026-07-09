import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getSecureHeaders } from "../_shared/secureHeaders.ts";

/**
 * Secure edge function for reading/writing sensitive site_settings keys.
 * Only admins can access. Secrets never transit through client RLS.
 */
const SENSITIVE_KEYS = [
  "smtp_settings",
  "whatsapp_settings",
  "s3_storage_settings",
  "payment_gateways",
  "ai_model_settings",
];

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

    // Verify user identity via JWT
    const { data: { user }, error: authError } = await admin.auth.getUser(token);
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Invalid token" }), { status: 401, headers });
    }

    // Verify admin role server-side
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
    const { action, key, value } = body;

    if (action === "read") {
      // Read one or all sensitive keys
      const keysToFetch = key ? [key] : SENSITIVE_KEYS;
      const validKeys = keysToFetch.filter((k: string) => SENSITIVE_KEYS.includes(k));

      if (validKeys.length === 0) {
        return new Response(JSON.stringify({ error: "Invalid key" }), { status: 400, headers });
      }

      const { data, error } = await admin
        .from("site_settings")
        .select("key, value")
        .in("key", validKeys);

      if (error) throw error;

      const result: Record<string, unknown> = {};
      (data ?? []).forEach((row: any) => {
        // Mask secret values for display
        result[row.key] = row.value;
      });

      return new Response(JSON.stringify({ settings: result }), { status: 200, headers });
    }

    if (action === "write") {
      if (!key || !SENSITIVE_KEYS.includes(key)) {
        return new Response(JSON.stringify({ error: "Invalid key" }), { status: 400, headers });
      }

      const { error } = await admin
        .from("site_settings")
        .upsert({
          key,
          value,
          updated_by: user.id,
          updated_at: new Date().toISOString(),
        }, { onConflict: "key" });

      if (error) throw error;

      // Audit log
      await admin.from("db_audit_logs").insert({
        table_name: "site_settings",
        operation: "UPDATE",
        row_id: key,
        new_data: { key, updated_by: user.id },
        changed_by: user.id,
      });

      return new Response(JSON.stringify({ success: true }), { status: 200, headers });
    }

    return new Response(JSON.stringify({ error: "Invalid action" }), { status: 400, headers });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
});
