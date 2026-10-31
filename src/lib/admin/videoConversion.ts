/**
 * Admin → Video Feature → Video Conversion (CONVERTER-DESIGN.md v2 §8).
 *
 * One lane setting, site_settings 'video_conversion' = "device" | "server".
 * Written through the same path every admin settings page uses — an upsert on
 * site_settings, which RLS allows to admins only ("Admins can manage
 * settings") — so no new SQL. Every change is recorded by the table's own
 * audit trigger (audit_site_settings → db_audit_logs, with who made it), and
 * the page reads its history back from there.
 *
 * Changing it decides only what the APP does next. The database enforces it
 * (video_source_begin refuses VID-SRC-001 unless it is "server" [R7]); the
 * device path works whatever it says.
 */
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { invalidateSiteSetting } from "@/lib/siteSettingsCache";
import { parseConversionMode, VIDEO_CONVERSION_KEY, type ConversionMode } from "@/lib/video/conversionMode";

export const CONVERSION_OPTIONS: ReadonlyArray<{ mode: ConversionMode; label: string; note: string }> = [
  {
    mode: "device",
    label: "On the member's device",
    note: "Their phone or computer prepares the video before it uploads. It takes about as long as the video, and the page must stay open and in front.",
  },
  {
    mode: "server",
    label: "On our server (Oracle)",
    note: "They upload the original once and our server prepares it. They can close the page once the upload reaches 100%, and formats a browser can't play work too.",
  },
];

export const conversionLabel = (m: ConversionMode) => CONVERSION_OPTIONS.find((o) => o.mode === m)?.label ?? m;

export interface ConversionState { mode: ConversionMode; updatedAt: string | null; updatedBy: string | null }
export interface ConversionChange { at: string; by: string | null; from: ConversionMode | null; to: ConversionMode }

/** What is stored, read fresh — not the members' one-minute cache: the admin sees what is saved. */
export async function loadConversionState(): Promise<ConversionState> {
  const { data, error } = await supabase
    .from("site_settings")
    .select("value, updated_at, updated_by")
    .eq("key", VIDEO_CONVERSION_KEY)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return { mode: parseConversionMode(data?.value), updatedAt: data?.updated_at ?? null, updatedBy: data?.updated_by ?? null };
}

/** The admin's write. Throws the database's message (e.g. an RLS refusal for a non-admin). */
export async function saveConversionMode(mode: ConversionMode, adminId: string): Promise<void> {
  const { error } = await supabase.from("site_settings").upsert(
    { key: VIDEO_CONVERSION_KEY, value: mode as Json, updated_by: adminId, updated_at: new Date().toISOString() },
    { onConflict: "key" },
  );
  // This device's own readers ask again at once; members' apps follow within minutes.
  invalidateSiteSetting(VIDEO_CONVERSION_KEY);
  if (error) throw new Error(error.message);
}

const modeIn = (row: unknown): ConversionMode | null =>
  row && typeof row === "object" && "value" in row ? parseConversionMode((row as { value: unknown }).value) : null;

/** The last changes, from the audit trail (admins read db_audit_logs). Empty on any error: the switch still works. */
export async function loadConversionHistory(limit = 10): Promise<ConversionChange[]> {
  try {
    const { data, error } = await supabase
      .from("db_audit_logs")
      .select("created_at, changed_by, old_data, new_data")
      .eq("table_name", "site_settings")
      .eq("row_id", VIDEO_CONVERSION_KEY)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    const out: ConversionChange[] = [];
    for (const r of data) {
      const to = modeIn(r.new_data);
      const from = modeIn(r.old_data);
      if (to && to !== from) out.push({ at: r.created_at, by: r.changed_by, from, to }); // a save that changed nothing is not news
    }
    return out;
  } catch {
    return [];
  }
}
