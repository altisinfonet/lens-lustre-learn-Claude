import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getSecureHeaders } from "../_shared/secureHeaders.ts";

Deno.serve(async (req) => {
  const secureHeaders = getSecureHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: secureHeaders });
  }

  const cronSecret = req.headers.get("x-cron-secret");
  if (!cronSecret || cronSecret !== Deno.env.get("CRON_SECRET")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...secureHeaders, "Content-Type": "application/json" } });
  }



  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    // Check last backup timestamp from site_settings
    const { data: setting } = await supabase
      .from("site_settings")
      .select("value")
      .eq("key", "last_db_backup")
      .maybeSingle();

    const lastBackup = setting?.value?.timestamp
      ? new Date(setting.value.timestamp as string)
      : null;

    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Only send reminder if no backup in the last 7 days
    if (lastBackup && lastBackup > sevenDaysAgo) {
      return new Response(
        JSON.stringify({ message: "Backup is recent, no reminder needed" }),
        { headers: { ...secureHeaders, "Content-Type": "application/json" } }
      );
    }

    const daysSince = lastBackup
      ? Math.floor((now.getTime() - lastBackup.getTime()) / (1000 * 60 * 60 * 24))
      : null;

    const message = lastBackup
      ? `Your last database backup was ${daysSince} day${daysSince !== 1 ? "s" : ""} ago. Visit Admin Panel → Settings to download a fresh SQL backup.`
      : "No database backup has been recorded yet. Visit Admin Panel → Settings to download your first SQL backup.";

    // Avoid duplicate reminders — check if an unread backup reminder already exists
    const { data: existing } = await supabase
      .from("admin_notifications")
      .select("id")
      .eq("type", "backup_reminder")
      .eq("is_read", false)
      .limit(1);

    if (existing && existing.length > 0) {
      return new Response(
        JSON.stringify({ message: "Unread reminder already exists, skipping" }),
        { headers: { ...secureHeaders, "Content-Type": "application/json" } }
      );
    }

    // Insert backup reminder notification
    const { error } = await supabase.from("admin_notifications").insert({
      type: "backup_reminder",
      title: "Database Backup Reminder",
      message,
    });

    if (error) throw error;

    return new Response(
      JSON.stringify({ message: "Backup reminder notification sent" }),
      { headers: { ...secureHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { ...secureHeaders, "Content-Type": "application/json" } }
    );
  }
});
