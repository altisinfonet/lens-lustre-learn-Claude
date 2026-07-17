import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getSecureHeaders } from "../_shared/secureHeaders.ts";

/**
 * Auto-scaling edge function for ad A/B traffic distribution.
 *
 * Evaluates each A/B-enabled ad slot's conversion performance over the last 7 days.
 * If the winning source (internal or adsense) has:
 *   - conversions > 10
 *   - AND conversion_rate 20%+ higher than the other source
 * Then gradually shift traffic toward the winner:
 *   50% → 70% → 90% (never jumps to 100%)
 *
 * Runs via cron every 6 hours.
 */

const STEP = 20;
const MAX_PCT = 90;
const MIN_PCT = 10;
const MIN_CONVERSIONS = 10;
const MIN_LIFT = 0.20;

Deno.serve(async (req: Request) => {
  const headers = getSecureHeaders(req);
  if (req.method === "OPTIONS") return new Response(null, { headers });

  const cronSecret = req.headers.get("x-cron-secret");
  if (!cronSecret || cronSecret !== Deno.env.get("CRON_SECRET")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...headers, "Content-Type": "application/json" } });
  }



  try {
    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // 1. Load ad slots config
    const { data: settingsRow } = await sb
      .from("site_settings")
      .select("value")
      .eq("key", "ad_slots")
      .maybeSingle();

    if (!settingsRow?.value || !Array.isArray(settingsRow.value)) {
      return new Response(JSON.stringify({ message: "No ad slots found" }), { status: 200, headers });
    }

    const slots = settingsRow.value as Record<string, unknown>[];
    const abSlots = slots.filter((s) => s.ab_enabled === true);

    if (abSlots.length === 0) {
      return new Response(JSON.stringify({ message: "No A/B slots to evaluate" }), { status: 200, headers });
    }

    // 2. Fetch aggregated stats via DB function (no row limits)
    const since = new Date();
    since.setDate(since.getDate() - 7);

    const { data: statsData, error: statsErr } = await sb.rpc("get_ad_autoscale_stats", {
      _since: since.toISOString(),
    });

    if (statsErr) {
      return new Response(JSON.stringify({ error: statsErr.message }), { status: 500, headers });
    }

    const stats = statsData as {
      impressions: { slot_id: string; ad_source: string; event_type: string; count: number }[];
      conversions: { ad_id: string; ad_source?: string | null; count: number }[];
      click_sources: { slot_id: string; ad_source: string }[];
    };

    // 3. Build click-source lookup (most recent click's ad_source per slot)
    const lastClickSource = new Map<string, string>();
    for (const cs of (stats.click_sources || [])) {
      lastClickSource.set(cs.slot_id, cs.ad_source === "adsense" ? "adsense" : "internal");
    }

    // 4. Aggregate per slot per source from pre-aggregated rows
    type SourceStats = { impressions: number; clicks: number; conversions: number };
    const slotStats = new Map<string, { internal: SourceStats; adsense: SourceStats }>();

    const getEntry = (slotId: string) => {
      if (!slotStats.has(slotId)) {
        slotStats.set(slotId, {
          internal: { impressions: 0, clicks: 0, conversions: 0 },
          adsense: { impressions: 0, clicks: 0, conversions: 0 },
        });
      }
      return slotStats.get(slotId)!;
    };

    for (const imp of (stats.impressions || [])) {
      const src = imp.ad_source === "adsense" ? "adsense" : "internal";
      const entry = getEntry(imp.slot_id);
      if (imp.event_type === "impression") entry[src].impressions += imp.count;
      else if (imp.event_type === "click") entry[src].clicks += imp.count;
    }

    // BUG-073: attribute each conversion to the source it RECORDED at click time
    // (ad_conversions.ad_source), so A/B credit reflects true per-source
    // performance instead of the single most-recent click source. Legacy rows
    // with no recorded source fall back to the last-click heuristic.
    for (const conv of (stats.conversions || [])) {
      const entry = slotStats.get(conv.ad_id);
      if (!entry) continue;
      const recorded = conv.ad_source === "adsense" ? "adsense" : conv.ad_source === "internal" ? "internal" : null;
      const src = recorded || lastClickSource.get(conv.ad_id) || "internal";
      entry[src as "internal" | "adsense"].conversions += conv.count;
    }

    // 4. Evaluate and adjust each A/B slot
    const adjustments: { slot_id: string; old_pct: number; new_pct: number; reason: string }[] = [];
    let changed = false;

    for (const slot of abSlots) {
      const slotId = slot.id as string;
      const currentPct = (slot.ab_adsense_pct as number) || 50;
      const stats = slotStats.get(slotId);

      if (!stats) continue;

      const intRate = stats.internal.clicks > 0 ? stats.internal.conversions / stats.internal.clicks : 0;
      const adsRate = stats.adsense.clicks > 0 ? stats.adsense.conversions / stats.adsense.clicks : 0;

      let newPct = currentPct;
      let reason = "no_change";

      // Internal is winning → decrease adsense pct
      if (
        stats.internal.conversions >= MIN_CONVERSIONS &&
        intRate > 0 &&
        (adsRate === 0 || (intRate - adsRate) / Math.max(adsRate, 0.001) >= MIN_LIFT)
      ) {
        newPct = Math.max(MIN_PCT, currentPct - STEP);
        reason = `internal_winning: int=${(intRate * 100).toFixed(1)}% ads=${(adsRate * 100).toFixed(1)}%`;
      }
      // AdSense is winning → increase adsense pct
      else if (
        stats.adsense.conversions >= MIN_CONVERSIONS &&
        adsRate > 0 &&
        (intRate === 0 || (adsRate - intRate) / Math.max(intRate, 0.001) >= MIN_LIFT)
      ) {
        newPct = Math.min(MAX_PCT, currentPct + STEP);
        reason = `adsense_winning: ads=${(adsRate * 100).toFixed(1)}% int=${(intRate * 100).toFixed(1)}%`;
      }

      if (newPct !== currentPct) {
        (slot as Record<string, unknown>).ab_adsense_pct = newPct;
        changed = true;
        adjustments.push({ slot_id: slotId, old_pct: currentPct, new_pct: newPct, reason });
      }
    }

    // 5. Persist changes
    if (changed) {
      await sb.from("site_settings").upsert(
        { key: "ad_slots", value: slots, updated_at: new Date().toISOString(), updated_by: "system-autoscale" },
        { onConflict: "key" }
      );
    }

    return new Response(
      JSON.stringify({ evaluated: abSlots.length, adjusted: adjustments.length, adjustments }),
      { status: 200, headers }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : "Unknown error" }),
      { status: 500, headers }
    );
  }
});
