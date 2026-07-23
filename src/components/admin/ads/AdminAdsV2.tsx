/**
 * AdminAdsV2 — control panel for the new Ad Zones v2 system.
 *
 * Reads/writes the v2 settings keys (ad_zones_v2, ad_frequency_v2,
 * ad_zones_v2_enabled) plus the shared adsense_config.publisher_id. Admins can
 * set each zone's single mode (off/google/own), supply the creative or Google
 * unit, tune the full-screen governor, and set the reward amount.
 *
 * Nothing here goes live until the master switch (top) is turned on — and even
 * then, a zone shows only if its mode is not "off".
 */
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/core/use-toast";
import { Loader2, Save, Power, LayoutGrid, Megaphone, Radio } from "lucide-react";
import {
  ALL_ZONES, ZONE_META, AD_ZONES_KEY, AD_FREQUENCY_KEY, AD_ZONES_FLAG_KEY,
  type AdZoneId, type AdZoneConfig, type AdZoneMode, type AdDevice, type AdFrequencyConfig,
  defaultZoneConfig, normalizeZone, defaultFrequencyConfig, normalizeFrequency,
} from "@/lib/ads/adZonesV2";

const hFont = { fontFamily: "var(--font-heading)" };
const bFont = { fontFamily: "var(--font-body)" };
const label = "block text-[10px] tracking-[0.15em] uppercase text-muted-foreground mb-1";
const input = "w-full bg-background border border-border rounded-sm px-3 py-2 text-xs text-foreground focus:outline-none focus:border-primary";

const DEVICES: AdDevice[] = ["desktop", "mobile", "tablet"];

async function saveSetting(key: string, value: unknown) {
  const { error } = await supabase.from("site_settings").upsert({ key, value } as any, { onConflict: "key" });
  if (error) throw error;
}

const AdminAdsV2 = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [tab, setTab] = useState<"zones" | "fullscreen" | "networks">("zones");

  const [enabled, setEnabled] = useState(false);
  const [zones, setZones] = useState<Record<AdZoneId, AdZoneConfig>>(() => {
    const o = {} as Record<AdZoneId, AdZoneConfig>;
    for (const z of ALL_ZONES) o[z] = defaultZoneConfig(z);
    return o;
  });
  const [freq, setFreq] = useState<AdFrequencyConfig>(defaultFrequencyConfig());
  const [publisherId, setPublisherId] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase.from("site_settings").select("key, value")
          .in("key", [AD_ZONES_KEY, AD_FREQUENCY_KEY, AD_ZONES_FLAG_KEY, "adsense_config"]);
        const byKey = new Map((data || []).map((r) => [r.key, r.value]));
        const storedZones = (byKey.get(AD_ZONES_KEY) || {}) as Record<string, unknown>;
        const z = {} as Record<AdZoneId, AdZoneConfig>;
        for (const zone of ALL_ZONES) z[zone] = normalizeZone(storedZones[zone], zone);
        setZones(z);
        setFreq(normalizeFrequency(byKey.get(AD_FREQUENCY_KEY)));
        setEnabled(byKey.get(AD_ZONES_FLAG_KEY) === true);
        setPublisherId(((byKey.get("adsense_config") as any)?.publisher_id) || "");
      } catch { /* keep defaults */ } finally { setLoading(false); }
    })();
  }, []);

  const patchZone = (zone: AdZoneId, patch: Partial<AdZoneConfig>) =>
    setZones((prev) => ({ ...prev, [zone]: { ...prev[zone], ...patch } }));
  const patchOwn = (zone: AdZoneId, patch: Partial<AdZoneConfig["own"]>) =>
    setZones((prev) => ({ ...prev, [zone]: { ...prev[zone], own: { ...prev[zone].own, ...patch } } }));
  const patchGoogle = (zone: AdZoneId, patch: Partial<AdZoneConfig["google"]>) =>
    setZones((prev) => ({ ...prev, [zone]: { ...prev[zone], google: { ...prev[zone].google, ...patch } } }));

  const doSave = async (what: string, fn: () => Promise<void>) => {
    setSaving(what);
    try { await fn(); window.dispatchEvent(new Event("ad-slots-updated")); toast({ title: "Saved" }); }
    catch (e: any) { toast({ title: "Save failed", description: e?.message, variant: "destructive" }); }
    finally { setSaving(null); }
  };

  const saveZones = () => doSave("zones", () => saveSetting(AD_ZONES_KEY, zones));
  const saveFreq = () => doSave("freq", () => saveSetting(AD_FREQUENCY_KEY, freq));
  const saveNetworks = () => doSave("net", async () => {
    const { data } = await supabase.from("site_settings").select("value").eq("key", "adsense_config").maybeSingle();
    const cur = (data?.value || {}) as Record<string, unknown>;
    await saveSetting("adsense_config", { ...cur, publisher_id: publisherId });
  });
  const toggleMaster = (v: boolean) => { setEnabled(v); doSave("flag", () => saveSetting(AD_ZONES_FLAG_KEY, v)); };

  const activeCount = useMemo(() => ALL_ZONES.filter((z) => zones[z].mode !== "off").length, [zones]);

  if (loading) return <div className="flex items-center gap-2 py-16 justify-center text-muted-foreground text-xs"><Loader2 className="h-4 w-4 animate-spin" /> Loading ad zones…</div>;

  return (
    <div className="space-y-5">
      {/* Master switch */}
      <div className={`border rounded-sm p-4 flex items-center justify-between gap-4 ${enabled ? "border-primary/40 bg-primary/5" : "border-border bg-muted/10"}`}>
        <div className="flex items-center gap-3">
          <Power className={`h-4 w-4 ${enabled ? "text-primary" : "text-muted-foreground"}`} />
          <div>
            <p className="text-sm font-semibold text-foreground" style={hFont}>Ad Zones v2 {enabled ? "— LIVE" : "— dormant"}</p>
            <p className="text-[10px] text-muted-foreground" style={bFont}>
              {enabled ? `${activeCount} zone(s) not "off". Zones render on the live site/app.` : "Master switch is off — the new ad system shows nothing. Configure zones below, then turn on."}
            </p>
          </div>
        </div>
        <button onClick={() => toggleMaster(!enabled)} disabled={saving === "flag"}
          className={`px-4 py-2 rounded-sm text-[10px] uppercase tracking-[0.15em] font-semibold ${enabled ? "bg-primary text-primary-foreground" : "bg-muted text-foreground border border-border"}`} style={hFont}>
          {saving === "flag" ? "…" : enabled ? "Turn OFF" : "Turn ON"}
        </button>
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-1.5 flex-wrap">
        {([["zones", "Zones", LayoutGrid], ["fullscreen", "Full-screen & Rewards", Megaphone], ["networks", "Networks", Radio]] as const).map(([k, l, Icon]) => (
          <button key={k} onClick={() => setTab(k)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-[10px] uppercase tracking-[0.12em] border ${tab === k ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:border-primary/50"}`} style={hFont}>
            <Icon className="h-3 w-3" /> {l}
          </button>
        ))}
      </div>

      {/* ── ZONES ── */}
      {tab === "zones" && (
        <div className="space-y-3">
          {ALL_ZONES.map((zone) => {
            const c = zones[zone];
            const meta = ZONE_META[zone];
            const isFull = meta.family === "fullscreen";
            return (
              <div key={zone} className="border border-border rounded-sm p-4 space-y-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <p className="text-xs font-semibold text-foreground" style={hFont}>{meta.label}</p>
                    <p className="text-[10px] text-muted-foreground" style={bFont}>{meta.hint}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={label + " !mb-0"}>Mode</span>
                    <select value={c.mode} onChange={(e) => patchZone(zone, { mode: e.target.value as AdZoneMode })} className="bg-background border border-border rounded-sm px-2 py-1.5 text-xs text-foreground">
                      <option value="off">Off</option>
                      <option value="own">My Ad</option>
                      <option value="google">Google Ad</option>
                    </select>
                  </div>
                </div>

                {c.mode === "own" && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                    <div className="md:col-span-2">
                      <label className={label}>Creative source</label>
                      <select value={c.own.image_source} onChange={(e) => patchOwn(zone, { image_source: e.target.value as any })} className="bg-background border border-border rounded-sm px-2 py-1.5 text-xs text-foreground">
                        <option value="upload">Image URL</option>
                        <option value="code">HTML code</option>
                      </select>
                    </div>
                    {c.own.image_source !== "code" ? (
                      <>
                        <div><label className={label}>Image URL</label><input className={input} style={bFont} value={c.own.image_url} onChange={(e) => patchOwn(zone, { image_url: e.target.value })} placeholder="https://cdn.50mmretina.com/…" /></div>
                        <div><label className={label}>Click URL</label><input className={input} style={bFont} value={c.own.click_url} onChange={(e) => patchOwn(zone, { click_url: e.target.value })} placeholder="https://…" /></div>
                        <div><label className={label}>Headline (optional)</label><input className={input} style={bFont} value={c.own.creative_headline} onChange={(e) => patchOwn(zone, { creative_headline: e.target.value })} /></div>
                        <div><label className={label}>Subtext (optional)</label><input className={input} style={bFont} value={c.own.creative_subtext} onChange={(e) => patchOwn(zone, { creative_subtext: e.target.value })} /></div>
                        <div><label className={label}>CTA text (optional)</label><input className={input} style={bFont} value={c.own.creative_cta} onChange={(e) => patchOwn(zone, { creative_cta: e.target.value })} /></div>
                        <div><label className={label}>Alt text</label><input className={input} style={bFont} value={c.own.alt_text} onChange={(e) => patchOwn(zone, { alt_text: e.target.value })} /></div>
                      </>
                    ) : (
                      <div className="md:col-span-2"><label className={label}>HTML code (sanitized on render)</label><textarea className={input + " min-h-[80px] font-mono"} value={c.own.ad_code} onChange={(e) => patchOwn(zone, { ad_code: e.target.value })} placeholder="<a href=…><img …></a>" /></div>
                    )}
                  </div>
                )}

                {c.mode === "google" && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                    <div><label className={label}>AdSense slot ID (data-ad-slot)</label><input className={input} style={bFont} value={c.google.adsense_slot_id} onChange={(e) => patchGoogle(zone, { adsense_slot_id: e.target.value })} placeholder="1234567890" /></div>
                    <div><label className={label}>Format</label>
                      <select value={c.google.adsense_format} onChange={(e) => patchGoogle(zone, { adsense_format: e.target.value })} className={input}>
                        <option value="auto">Auto</option><option value="horizontal">Horizontal</option><option value="vertical">Vertical</option><option value="rectangle">Rectangle</option>
                      </select>
                    </div>
                    {isFull && <p className="md:col-span-2 text-[10px] text-amber-600 dark:text-amber-400" style={bFont}>Note: Google full-screen (interstitial/rewarded/app-open) needs AdMob (Phase 2, native app). AdSense here won't render full-screen — use "My Ad" for these zones in Phase 1.</p>}
                  </div>
                )}

                {c.mode !== "off" && (
                  <div className="flex items-center gap-3 pt-1">
                    <span className={label + " !mb-0"}>Devices</span>
                    {DEVICES.map((d) => (
                      <label key={d} className="flex items-center gap-1 text-[11px] text-foreground" style={bFont}>
                        <input type="checkbox" className="accent-primary" checked={c.devices.includes(d)} onChange={(e) => {
                          const set = new Set(c.devices);
                          e.target.checked ? set.add(d) : set.delete(d);
                          patchZone(zone, { devices: Array.from(set) as AdDevice[] });
                        }} /> {d}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          <button onClick={saveZones} disabled={saving === "zones"} className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground text-xs uppercase tracking-[0.15em] rounded-sm disabled:opacity-50" style={hFont}>
            {saving === "zones" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save zones
          </button>
        </div>
      )}

      {/* ── FULL-SCREEN & REWARDS ── */}
      {tab === "fullscreen" && (
        <div className="space-y-4">
          <div className="border border-border rounded-sm p-4 space-y-3">
            <p className="text-xs font-semibold text-foreground" style={hFont}>Interstitial triggers</p>
            {[["interstitial_after_post", "After a user posts"], ["interstitial_feed_to_competition", "Opening a competition from the feed"], ["interstitial_on_app_open", "App open / splash"]].map(([k, l]) => (
              <label key={k} className="flex items-center gap-2 text-[11px] text-foreground" style={bFont}>
                <input type="checkbox" className="accent-primary" checked={(freq as any)[k]} onChange={(e) => setFreq({ ...freq, [k]: e.target.checked })} /> {l}
              </label>
            ))}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-1">
              <div><label className={label}>Min gap (sec)</label><input type="number" className={input} value={freq.interstitial_min_gap_seconds} onChange={(e) => setFreq({ ...freq, interstitial_min_gap_seconds: +e.target.value })} /></div>
              <div><label className={label}>Max / day</label><input type="number" className={input} value={freq.interstitial_max_per_day} onChange={(e) => setFreq({ ...freq, interstitial_max_per_day: +e.target.value })} /></div>
              <div><label className={label}>Skippable after (sec)</label><input type="number" className={input} value={freq.interstitial_skippable_after_seconds} onChange={(e) => setFreq({ ...freq, interstitial_skippable_after_seconds: +e.target.value })} /></div>
              <div><label className={label}>App-open gap (hrs)</label><input type="number" className={input} value={freq.app_open_min_gap_hours} onChange={(e) => setFreq({ ...freq, app_open_min_gap_hours: +e.target.value })} /></div>
            </div>
            <label className="flex items-center gap-2 text-[11px] text-foreground" style={bFont}>
              <input type="checkbox" className="accent-primary" checked={freq.interstitial_skip_first_session} onChange={(e) => setFreq({ ...freq, interstitial_skip_first_session: e.target.checked })} /> Never show during a user's first session
            </label>
          </div>

          <div className="border border-border rounded-sm p-4 space-y-3">
            <p className="text-xs font-semibold text-foreground" style={hFont}>Rewarded ad → wallet credit</p>
            <p className="text-[10px] text-muted-foreground" style={bFont}>User views a static sponsor for the attention seconds (foreground), then earns credits. Amount 0 = no reward is offered.</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div><label className={label}>Credit amount</label><input type="number" step="0.01" className={input} value={freq.rewarded_credit_amount} onChange={(e) => setFreq({ ...freq, rewarded_credit_amount: +e.target.value })} /></div>
              <div><label className={label}>Attention (sec)</label><input type="number" className={input} value={freq.rewarded_attention_seconds} onChange={(e) => setFreq({ ...freq, rewarded_attention_seconds: +e.target.value })} /></div>
              <div><label className={label}>Max / day</label><input type="number" className={input} value={freq.rewarded_max_per_day} onChange={(e) => setFreq({ ...freq, rewarded_max_per_day: +e.target.value })} /></div>
              <div><label className={label}>Cooldown (min)</label><input type="number" className={input} value={freq.rewarded_cooldown_minutes} onChange={(e) => setFreq({ ...freq, rewarded_cooldown_minutes: +e.target.value })} /></div>
            </div>
            <p className="text-[10px] text-muted-foreground" style={bFont}>Max payout per user per day = amount × max/day = <strong className="text-foreground">{(freq.rewarded_credit_amount * freq.rewarded_max_per_day).toFixed(2)}</strong> credits.</p>
          </div>

          <button onClick={saveFreq} disabled={saving === "freq"} className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground text-xs uppercase tracking-[0.15em] rounded-sm disabled:opacity-50" style={hFont}>
            {saving === "freq" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save full-screen & rewards
          </button>
        </div>
      )}

      {/* ── NETWORKS ── */}
      {tab === "networks" && (
        <div className="space-y-4">
          <div className="border border-border rounded-sm p-4 space-y-3">
            <p className="text-xs font-semibold text-foreground" style={hFont}>Google AdSense (web display)</p>
            <div><label className={label}>Publisher ID</label><input className={input} style={bFont} value={publisherId} onChange={(e) => setPublisherId(e.target.value)} placeholder="ca-pub-XXXXXXXXXXXXXXXX" /></div>
            <p className="text-[10px] text-amber-600 dark:text-amber-400" style={bFont}>Reminder: AdSense is for the website only. Do NOT rely on it inside the Android app (AdMob is the app-correct product — Phase 2). Zones set to "Google Ad" render AdSense on web; in the app they render nothing until AdMob is added.</p>
          </div>
          <button onClick={saveNetworks} disabled={saving === "net"} className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground text-xs uppercase tracking-[0.15em] rounded-sm disabled:opacity-50" style={hFont}>
            {saving === "net" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save networks
          </button>
        </div>
      )}
    </div>
  );
};

export default AdminAdsV2;
