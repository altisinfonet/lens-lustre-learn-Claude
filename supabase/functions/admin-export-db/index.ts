import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { getSecureHeaders } from "../_shared/secureHeaders.ts";

/**
 * Server-side database export with admin verification and audit logging.
 * Returns SQL INSERT statements for backup.
 */
const EXPORTABLE_TABLES = [
  "profiles", "user_roles", "user_badges", "competitions", "competition_entries",
  "competition_votes", "competition_payment_details", "courses", "course_enrollments",
  "lessons", "lesson_progress", "journal_articles", "certificates", "certificate_testimonials",
  "portfolio_images", "posts", "post_comments", "post_reactions", "comments",
  "image_comments", "image_reactions", "friendships", "follows", "wallets",
  "wallet_transactions", "withdrawal_requests", "bank_details", "referral_codes",
  "referrals", "gift_credits", "gift_announcements", "hero_banners", "photo_of_the_day",
  "featured_artists", "support_tickets", "ticket_replies", "email_templates",
  "site_settings", "ad_impressions", "admin_notifications", "user_notifications",
  "activity_logs", "comment_reports", "scheduled_boosts",
];

// BUG-027 / BUG-106: the export must NOT ship provider secrets or sensitive
// PII/financial data in plaintext. Those values are redacted below; the backup
// stays structurally complete but crown-jewel fields must be re-provisioned on
// restore (they should never live in a downloadable file).
const REDACTION = "***REDACTED***";

// site_settings rows whose `value` is a credential blob (keys mirror the
// public-read secret blocklist). Their value is replaced with the marker.
const SECRET_SETTINGS_KEYS = new Set<string>([
  "s3_storage_settings", "smtp_settings", "whatsapp_settings",
  "payment_gateways", "ai_model_settings",
]);

// table -> columns whose values are redacted (financial account details + PII).
const REDACT_COLUMNS: Record<string, Set<string>> = {
  profiles: new Set([
    "address_line1", "address_line2", "city", "state", "country", "postal_code",
    "phone", "whatsapp", "national_id_url", "date_of_birth",
  ]),
  bank_details: new Set(["bank_account_name", "bank_account_number", "bank_name", "bank_ifsc"]),
  competition_payment_details: new Set(["paypal_email", "bank_details", "upi_id"]),
  withdrawal_requests: new Set(["bank_details"]),
};

function escapeSQL(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    return `ARRAY[${value.map((v) => `'${String(v).replace(/'/g, "''")}'`).join(",")}]::text[]`;
  }
  if (typeof value === "object") {
    return `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}

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

    // Verify admin
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

    // Audit log BEFORE export
    await admin.from("db_audit_logs").insert({
      table_name: "system",
      operation: "EXPORT",
      row_id: "database_backup",
      new_data: { 
        exported_by: user.id, 
        tables: EXPORTABLE_TABLES.length,
        timestamp: new Date().toISOString(),
        ip: req.headers.get("x-forwarded-for") || "unknown",
      },
      changed_by: user.id,
    });

    const lines: string[] = [
      `-- Database Backup (Server-Side)`,
      `-- Generated: ${new Date().toISOString()}`,
      `-- Exported by: ${user.id}`,
      `-- Tables: ${EXPORTABLE_TABLES.length}`,
      `-- NOTE: Provider secrets (site_settings credential keys) and sensitive`,
      `-- PII/financial fields (bank details, home address, phone, national ID,`,
      `-- date of birth, payout details) are REDACTED as '${REDACTION}' and must`,
      `-- be re-provisioned on restore.`,
      "",
      "BEGIN;",
      "",
    ];

    let totalRows = 0;

    // Convert one row to an INSERT, redacting secrets/PII (BUG-027 / BUG-106).
    const rowToInsert = (t: string, row: Record<string, any>, redactCols?: Set<string>): string => {
      const cols = Object.keys(row);
      const vals = cols.map((c) => {
        // Redact credential values in site_settings, keyed by row.key
        if (t === "site_settings" && c === "value" && SECRET_SETTINGS_KEYS.has(row.key)) {
          return escapeSQL(REDACTION);
        }
        // Redact sensitive PII/financial columns (leave NULLs as NULL)
        if (redactCols && redactCols.has(c) && row[c] !== null && row[c] !== undefined) {
          return escapeSQL(REDACTION);
        }
        return escapeSQL(row[c]);
      });
      return `INSERT INTO public.${t} (${cols.join(", ")}) VALUES (${vals.join(", ")});`;
    };

    // BUG-026: page through EVERY row instead of the old silent 10k cap.
    const PAGE = 1000;
    const MAX_ROWS_PER_TABLE = 500000; // hard safety bound so one huge table can't OOM the export

    for (const table of EXPORTABLE_TABLES) {
      try {
        // Exact count → honest header + completeness check.
        const { count, error: countErr } = await admin
          .from(table)
          .select("*", { count: "exact", head: true });
        if (countErr) {
          lines.push(`-- ERROR counting ${table}: ${countErr.message}`);
          continue;
        }
        if (!count) {
          lines.push(`-- ${table}: 0 rows`);
          lines.push("");
          continue;
        }

        lines.push(`-- ${table}: ${count} rows`);
        const redactCols = REDACT_COLUMNS[table];
        const orderCol = table === "site_settings" ? "key" : "id"; // stable pagination key
        let emitted = 0;
        let offset = 0;
        while (emitted < count && offset < MAX_ROWS_PER_TABLE) {
          const { data, error } = await admin
            .from(table)
            .select("*")
            .order(orderCol, { ascending: true })
            .range(offset, offset + PAGE - 1);
          if (error) {
            lines.push(`-- ERROR exporting ${table} at offset ${offset}: ${error.message}`);
            break;
          }
          if (!data || data.length === 0) break;
          for (const row of data) {
            lines.push(rowToInsert(table, row as Record<string, any>, redactCols));
            emitted++;
            totalRows++;
          }
          offset += data.length; // advance by rows actually returned (robust to PostgREST max-rows)
        }
        // BUG-026: never truncate silently — if the safety bound is ever hit, say so loudly.
        if (emitted < count) {
          lines.push(
            `-- WARNING: ${table} has ${count} rows but only ${emitted} were exported ` +
            `(safety cap ${MAX_ROWS_PER_TABLE}). THIS TABLE IS INCOMPLETE.`
          );
        }
        lines.push("");
      } catch (err: any) {
        lines.push(`-- ERROR exporting ${table}: ${err.message}`);
      }
    }

    lines.push("COMMIT;");
    lines.push("");
    lines.push(`-- Total rows exported: ${totalRows}`);

    // Save last backup timestamp
    await admin.from("site_settings").upsert(
      { key: "last_db_backup", value: { timestamp: new Date().toISOString(), exported_by: user.id, total_rows: totalRows }, updated_at: new Date().toISOString() },
      { onConflict: "key" }
    );

    return new Response(lines.join("\n"), {
      status: 200,
      headers: {
        ...headers,
        "Content-Type": "application/sql",
        "Content-Disposition": `attachment; filename="backup_${new Date().toISOString().slice(0, 10)}.sql"`,
      },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers });
  }
});
