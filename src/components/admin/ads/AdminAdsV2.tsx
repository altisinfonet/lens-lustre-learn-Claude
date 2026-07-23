/**
 * AdminAdsV2 — control panel for the Ad Zones system, built to be usable by a
 * complete beginner:
 *   • Every spot is described in plain words ("where it shows").
 *   • Pictures are UPLOADED from the computer with one button — no URLs needed.
 *   • The exact best picture size is shown next to each upload.
 *   • A Performance tab shows how many times each ad was seen and clicked.
 *
 * Reads/writes the settings keys (ad_zones_v2, ad_frequency_v2,
 * ad_zones_v2_enabled) + the shared adsense_config.publisher_id. Nothing goes
 * live until the master switch (top) is on, and a spot shows only if it isn't
 * "Off".
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/core/use-toast";
import { Loader2, Save, Power, LayoutGrid, Megaphone, Radio, BarChart3, Upload, Trash2, RefreshCw } from "lucide-react";
import {
  ALL_ZONES, ZONE_META, AD_ZONES_KEY, AD_FREQUENCY_KEY, AD_ZONES_FLAG_KEY,
  type AdZoneId, type AdZoneConfig, type AdZoneMode, type AdDevice, type AdFrequencyConfig,
  defaultZoneConfig, normalizeZone, defaultFrequencyConfig, normalizeFrequency,
} from "@/lib/ads/adZonesV2";
import { compressImageToFiles } from "@/lib/imageCompression";
import { generateImagePath, uploadImage } from "@/lib/imageUpload";

const hFont = { fontFamily: "var(--font-heading)" };
const bFont = { fontFamily: "var(--font-body)" };
const label = "block text-[10px] tracking-[0.15em] uppercase text-muted-foreground mb-1";
const input = "w-full bg-background border border-border rounded-sm px-3 py-2 text-xs text-foreground focus:outline-none focus:border-primary";

const DEVICES: { key: AdDevice; label: string }[] = [
  { key: "mobile", label: "📱 Phone" },
  { key: "tablet", label: "▭ Tablet" },
  { key: "desktop", label: "🖥 Computer" },
];

/** Plain-language guide shown on every spot: where it appears + best picture size. */
const ZONE_GUIDE: Record<AdZoneId, { where: string; size: string; shape: string; tip: string }> = {
  sidebar: {
    where: "On the right side of the feed — only on computers.",
    size: "600 × 600", shape: "square", tip: "A square logo or banner works best.",
  },
  "story-card": {
    where: "Inside the feed, like a normal post. This is the main one phone users see.",
    size: "1080 × 1350", shape: "tall (like a phone photo)", tip: "Make it tall, not wide.",
  },
  lightbox: {
    where: "Under a big photo, when someone opens a picture full-screen.",
    size: "1200 × 628", shape: "wide banner", tip: "A wide banner works best.",
  },
  interstitial: {
    where: "A full-screen ad after someone posts, or opens a competition from the feed.",
    size: "1080 × 1920", shape: "full phone screen (tall)", tip: "Use a full phone-screen picture.",
  },
  rewarded: {
    where: "Shown when someone taps “watch an ad to earn credits” in their wallet.",
    size: "1080 × 1920", shape: "full phone screen (tall)", tip: "Use a full phone-screen picture.",
  },
  "app-open": {
    where: "A full-screen ad the moment the app opens.",
    size: "1080 × 1920", shape: "full phone screen (tall)", tip: "Use a full phone-screen picture.",
  },
};

async function saveSetting(key: string, value: unknown) {
  const { error } = await supabase.from("site_settings").upsert({ key, value } as any, { onConflict: "key" });
  if (error) throw error;
}

/* ── One-button picture uploader (compress → upload → preview) ── */
const ImageUploader = ({ zone, value, onChange }: { zone: AdZoneId; value: string; onChange: (url: string) => void }) => {
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const guide = ZONE_GUIDE[zone];

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (e.target) e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast({ title: "Please choose an image file (jpg / png / webp)", variant: "destructive" }); return; }
    setBusy(true);
    try {
      const { webpFile } = await compressImageToFiles(file, `ad-${zone}`, { maxDimension: 1600 });
      const path = generateImagePath({ type: "ad", ext: "webp" });
      const { url } = await uploadImage({ bucket: "journal-images", file: webpFile, path, type: "ad", fileName: `ad-${zone}.webp` });
      onChange(url);
      toast({ title: "Picture uploaded ✅" });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err?.message || "Please try again", variant: "destructive" });
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-2">
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={onFile} />
      {value ? (
        <div className="flex items-center gap-3">
          <img src={value} alt="Your ad" className="h-24 w-24 object-cover rounded-sm border border-border bg-muted/20" />
          <div className="flex flex-col gap-2">
            <button type="button" onClick={() => inputRef.current?.click()} disabled={busy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-sm border border-border text-[11px] text-foreground hover:border-primary disabled:opacity-50" style={hFont}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />} Change picture
            </button>
            <button type="button" onClick={() => onChange("")} disabled={busy}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-sm border border-border text-[11px] text-muted-foreground hover:text-destructive hover:border-destructive/50 disabled:opacity-50" style={hFont}>
              <Trash2 className="h-3.5 w-3.5" /> Remove
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => inputRef.current?.click()} disabled={busy}
          className="w-full border-2 border-dashed border-border rounded-sm py-7 flex flex-col items-center justify-center gap-1.5 hover:border-primary/60 hover:bg-primary/5 transition-colors disabled:opacity-60">
          {busy ? <Loader2 className="h-5 w-5 animate-spin text-primary" /> : <Upload className="h-5 w-5 text-primary" />}
          <span className="text-xs font-medium text-foreground" style={hFont}>{busy ? "Uploading…" : "Upload a picture from your computer"}</span>
          <span className="text-[10px] text-muted-foreground" style={bFont}>Tap here and pick an image (jpg, png or webp)</span>
        </button>
      )}
      <p className="text-[10px] text-muted-foreground" style={bFont}>
        Best picture size: <strong className="text-foreground">{guide.size} px</strong> ({guide.shape}). {guide.tip}
      </p>
    </div>
  );
};

const AdminAdsV2 = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [tab, setTab] = useState<"zones" | "fullscreen" | "networks" | "performance">("zones");

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
    try { await fn(); window.dispatchEvent(new Event("ad-slots-updated")); toast({ title: "Saved ✅" }); }
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

  /* ── Performance (impressions / clicks per spot) ── */
  const [perfDays, setPerfDays] = useState(7);
  const [perf, setPerf] = useState<Record<AdZoneId, { imp: number; clk: number }> | null>(null);
  const [perfLoading, setPerfLoading] = useState(false);

  const loadPerf = useCallback(async () => {
    setPerfLoading(true);
    try {
      const since = new Date(Date.now() - perfDays * 86400000).toISOString();
      const rows = await Promise.all(
        ALL_ZONES.flatMap((z) =>
          (["impression", "click"] as const).map(async (ev) => {
            const { count } = await supabase
              .from("ad_impressions")
              .select("id", { count: "exact", head: true })
              .eq("placement", z)
              .eq("event_type", ev)
              .gte("created_at", since);
            return { z, ev, count: count || 0 };
          }),
        ),
      );
      const map = {} as Record<AdZoneId, { imp: number; clk: number }>;
      for (const z of ALL_ZONES) map[z] = { imp: 0, clk: 0 };
      for (const r of rows) { if (r.ev === "impression") map[r.z].imp = r.count; else map[r.z].clk = r.count; }
      setPerf(map);
    } catch { setPerf(null); } finally { setPerfLoading(false); }
  }, [perfDays]);

  useEffect(() => { if (tab === "performance") loadPerf(); }, [tab, loadPerf]);

  if (loading) return <div className="flex items-center gap-2 py-16 justify-center text-muted-foreground text-xs"><Loader2 className="h-4 w-4 animate-spin" /> Loading ad zones…</div>;

  return (
    <div className="space-y-5">
      {/* Master switch */}
      <div className={`border rounded-sm p-4 flex items-center justify-between gap-4 ${enabled ? "border-primary/40 bg-primary/5" : "border-border bg-muted/10"}`}>
        <div className="flex items-center gap-3">
          <Power className={`h-4 w-4 ${enabled ? "text-primary" : "text-muted-foreground"}`} />
          <div>
            <p className="text-sm font-semibold text-foreground" style={hFont}>Ads are {enabled ? "ON — showing on the site" : "OFF — nothing is showing"}</p>
            <p className="text-[10px] text-muted-foreground" style={bFont}>
              {enabled ? `${activeCount} spot(s) turned on.` : "This is the big on/off switch. Set up your spots below first, then turn this ON."}
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
        {([["zones", "Ad Spots", LayoutGrid], ["fullscreen", "Full-screen & Rewards", Megaphone], ["performance", "Performance", BarChart3], ["networks", "Networks", Radio]] as const).map(([k, l, Icon]) => (
          <button key={k} onClick={() => setTab(k)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-sm text-[10px] uppercase tracking-[0.12em] border ${tab === k ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground hover:border-primary/50"}`} style={hFont}>
            <Icon className="h-3 w-3" /> {l}
          </button>
        ))}
      </div>

      {/* ── AD SPOTS ── */}
      {tab === "zones" && (
        <div className="space-y-3">
          <div className="rounded-sm border border-primary/20 bg-primary/5 p-3 text-[11px] text-foreground" style={bFont}>
            <strong>How it works:</strong> for each spot below, choose <em>My picture</em> and upload an image (or <em>Google ad</em>), then press <em>Save</em>. When you’re ready, flip the big <strong>ON</strong> switch at the top.
          </div>

          {ALL_ZONES.map((zone) => {
            const c = zones[zone];
            const meta = ZONE_META[zone];
            const guide = ZONE_GUIDE[zone];
            const isFull = meta.family === "fullscreen";
            const modes: { key: AdZoneMode; label: string }[] = [
              { key: "off", label: "Off" },
              { key: "own", label: "My picture" },
              { key: "google", label: "Google ad" },
            ];
            return (
              <div key={zone} className="border border-border rounded-sm p-4 space-y-3">
                <div>
                  <p className="text-sm font-semibold text-foreground" style={hFont}>{meta.label}</p>
                  <p className="text-[11px] text-muted-foreground" style={bFont}>{guide.where}</p>
                </div>

                {/* Simple 3-way choice */}
                <div className="flex gap-1.5">
                  {modes.map((m) => (
                    <button key={m.key} onClick={() => patchZone(zone, { mode: m.key })}
                      className={`px-3 py-1.5 rounded-sm text-[11px] border ${c.mode === m.key ? "bg-primary text-primary-foreground border-primary" : "border-border text-foreground hover:border-primary/50"}`} style={hFont}>
                      {m.label}
                    </button>
                  ))}
                </div>

                {c.mode === "own" && (
                  <div className="space-y-3 pt-1">
                    <ImageUploader zone={zone} value={c.own.image_source === "code" ? "" : c.own.image_url}
                      onChange={(url) => patchOwn(zone, { image_url: url, image_source: "upload" })} />
                    <div>
                      <label className={label}>Website to open when clicked (optional)</label>
                      <input className={input} style={bFont} value={c.own.click_url} onChange={(e) => patchOwn(zone, { click_url: e.target.value })} placeholder="https://your-website.com" />
                    </div>

                    <details className="group">
                      <summary className="cursor-pointer text-[10px] uppercase tracking-[0.15em] text-primary/80 hover:text-primary select-none" style={hFont}>More options (not needed)</summary>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-3">
                        <div><label className={label}>Small text on top (optional)</label><input className={input} style={bFont} value={c.own.creative_headline} onChange={(e) => patchOwn(zone, { creative_headline: e.target.value })} /></div>
                        <div><label className={label}>Smaller text (optional)</label><input className={input} style={bFont} value={c.own.creative_subtext} onChange={(e) => patchOwn(zone, { creative_subtext: e.target.value })} /></div>
                        <div><label className={label}>Button text (optional)</label><input className={input} style={bFont} value={c.own.creative_cta} onChange={(e) => patchOwn(zone, { creative_cta: e.target.value })} /></div>
                        <div><label className={label}>Describe the picture (for accessibility)</label><input className={input} style={bFont} value={c.own.alt_text} onChange={(e) => patchOwn(zone, { alt_text: e.target.value })} /></div>
                        <div className="md:col-span-2"><label className={label}>Or paste a picture link instead of uploading</label><input className={input} style={bFont} value={c.own.image_source === "code" ? "" : c.own.image_url} onChange={(e) => patchOwn(zone, { image_url: e.target.value, image_source: "upload" })} placeholder="https://…/image.jpg" /></div>
                      </div>
                    </details>
                  </div>
                )}

                {c.mode === "google" && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
                    <div><label className={label}>Google ad slot ID</label><input className={input} style={bFont} value={c.google.adsense_slot_id} onChange={(e) => patchGoogle(zone, { adsense_slot_id: e.target.value })} placeholder="e.g. 1234567890" /></div>
                    <div><label className={label}>Shape</label>
                      <select value={c.google.adsense_format} onChange={(e) => patchGoogle(zone, { adsense_format: e.target.value })} className={input}>
                        <option value="auto">Auto</option><option value="horizontal">Wide</option><option value="vertical">Tall</option><option value="rectangle">Box</option>
                      </select>
                    </div>
                    <p className="md:col-span-2 text-[10px] text-muted-foreground" style={bFont}>Add your Publisher ID once in the <strong>Networks</strong> tab. Google ads show on the website; inside the phone app they need AdMob (coming later).</p>
                    {isFull && <p className="md:col-span-2 text-[10px] text-amber-600 dark:text-amber-400" style={bFont}>Full-screen Google ads need AdMob (later). For now use <em>My picture</em> for this spot.</p>}
                  </div>
                )}

                {c.mode !== "off" && (
                  <div className="flex items-center gap-2 pt-1 flex-wrap">
                    <span className={label + " !mb-0"}>Show on</span>
                    {DEVICES.map((d) => {
                      const on = c.devices.includes(d.key);
                      return (
                        <button key={d.key} onClick={() => {
                          const set = new Set(c.devices);
                          on ? set.delete(d.key) : set.add(d.key);
                          patchZone(zone, { devices: Array.from(set) as AdDevice[] });
                        }} className={`px-2.5 py-1 rounded-sm text-[11px] border ${on ? "bg-primary/10 border-primary/50 text-foreground" : "border-border text-muted-foreground"}`} style={bFont}>
                          {d.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}

          <button onClick={saveZones} disabled={saving === "zones"} className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground text-xs uppercase tracking-[0.15em] rounded-sm disabled:opacity-50" style={hFont}>
            {saving === "zones" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save
          </button>
        </div>
      )}

      {/* ── FULL-SCREEN & REWARDS ── */}
      {tab === "fullscreen" && (
        <div className="space-y-4">
          <div className="border border-border rounded-sm p-4 space-y-3">
            <p className="text-xs font-semibold text-foreground" style={hFont}>When should the full-screen ad appear?</p>
            {[["interstitial_after_post", "After a user posts a photo"], ["interstitial_feed_to_competition", "When they open a competition from the feed"], ["interstitial_on_app_open", "When the app first opens"]].map(([k, l]) => (
              <label key={k} className="flex items-center gap-2 text-[11px] text-foreground" style={bFont}>
                <input type="checkbox" className="accent-primary" checked={(freq as any)[k]} onChange={(e) => setFreq({ ...freq, [k]: e.target.checked })} /> {l}
              </label>
            ))}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-1">
              <div><label className={label}>Wait between ads (sec)</label><input type="number" className={input} value={freq.interstitial_min_gap_seconds} onChange={(e) => setFreq({ ...freq, interstitial_min_gap_seconds: +e.target.value })} /></div>
              <div><label className={label}>Most per day</label><input type="number" className={input} value={freq.interstitial_max_per_day} onChange={(e) => setFreq({ ...freq, interstitial_max_per_day: +e.target.value })} /></div>
              <div><label className={label}>Skip button after (sec)</label><input type="number" className={input} value={freq.interstitial_skippable_after_seconds} onChange={(e) => setFreq({ ...freq, interstitial_skippable_after_seconds: +e.target.value })} /></div>
              <div><label className={label}>App-open gap (hrs)</label><input type="number" className={input} value={freq.app_open_min_gap_hours} onChange={(e) => setFreq({ ...freq, app_open_min_gap_hours: +e.target.value })} /></div>
            </div>
            <label className="flex items-center gap-2 text-[11px] text-foreground" style={bFont}>
              <input type="checkbox" className="accent-primary" checked={freq.interstitial_skip_first_session} onChange={(e) => setFreq({ ...freq, interstitial_skip_first_session: e.target.checked })} /> Don’t show to brand-new visitors on their first visit
            </label>
            <p className="text-[10px] text-muted-foreground" style={bFont}>Upload the full-screen picture itself under <strong>Ad Spots → Interstitial / App Open</strong>.</p>
          </div>

          <div className="border border-border rounded-sm p-4 space-y-3">
            <p className="text-xs font-semibold text-foreground" style={hFont}>Reward: pay wallet credits for watching an ad</p>
            <p className="text-[10px] text-muted-foreground" style={bFont}>A person looks at a still ad for the seconds below, then earns credits. Set the amount to <strong>0</strong> to give no reward (the “watch to earn” button then hides). Upload the reward picture under <strong>Ad Spots → Rewarded</strong>.</p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div><label className={label}>Credits per watch</label><input type="number" step="0.01" className={input} value={freq.rewarded_credit_amount} onChange={(e) => setFreq({ ...freq, rewarded_credit_amount: +e.target.value })} /></div>
              <div><label className={label}>Watch time (sec)</label><input type="number" className={input} value={freq.rewarded_attention_seconds} onChange={(e) => setFreq({ ...freq, rewarded_attention_seconds: +e.target.value })} /></div>
              <div><label className={label}>Most per day</label><input type="number" className={input} value={freq.rewarded_max_per_day} onChange={(e) => setFreq({ ...freq, rewarded_max_per_day: +e.target.value })} /></div>
              <div><label className={label}>Wait between (min)</label><input type="number" className={input} value={freq.rewarded_cooldown_minutes} onChange={(e) => setFreq({ ...freq, rewarded_cooldown_minutes: +e.target.value })} /></div>
            </div>
            <p className="text-[10px] text-muted-foreground" style={bFont}>Most a single person can earn per day = amount × most/day = <strong className="text-foreground">{(freq.rewarded_credit_amount * freq.rewarded_max_per_day).toFixed(2)}</strong> credits.</p>
          </div>

          <button onClick={saveFreq} disabled={saving === "freq"} className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground text-xs uppercase tracking-[0.15em] rounded-sm disabled:opacity-50" style={hFont}>
            {saving === "freq" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save
          </button>
        </div>
      )}

      {/* ── PERFORMANCE ── */}
      {tab === "performance" && (
        <div className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] text-muted-foreground" style={bFont}>Show the last</span>
            {[7, 30, 90].map((d) => (
              <button key={d} onClick={() => setPerfDays(d)} className={`px-3 py-1.5 rounded-sm text-[11px] border ${perfDays === d ? "bg-primary text-primary-foreground border-primary" : "border-border text-foreground hover:border-primary/50"}`} style={hFont}>{d} days</button>
            ))}
            <button onClick={loadPerf} disabled={perfLoading} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-sm border border-border text-[11px] text-foreground hover:border-primary disabled:opacity-50 ml-auto" style={hFont}>
              <RefreshCw className={`h-3.5 w-3.5 ${perfLoading ? "animate-spin" : ""}`} /> Refresh
            </button>
          </div>

          <div className="border border-border rounded-sm overflow-hidden">
            <div className="grid grid-cols-[1.4fr_1fr_1fr_1fr] bg-muted/30 px-4 py-2 text-[10px] uppercase tracking-[0.12em] text-muted-foreground" style={hFont}>
              <span>Ad spot</span><span className="text-right">Times shown</span><span className="text-right">Clicks</span><span className="text-right">Click rate</span>
            </div>
            {perfLoading ? (
              <div className="flex items-center gap-2 justify-center py-10 text-muted-foreground text-xs"><Loader2 className="h-4 w-4 animate-spin" /> Counting…</div>
            ) : (
              ALL_ZONES.map((z) => {
                const p = perf?.[z];
                const imp = p?.imp || 0, clk = p?.clk || 0;
                const ctr = imp > 0 ? `${((clk / imp) * 100).toFixed(1)}%` : "—";
                return (
                  <div key={z} className="grid grid-cols-[1.4fr_1fr_1fr_1fr] px-4 py-2.5 text-xs text-foreground border-t border-border" style={bFont}>
                    <span className="font-medium">{ZONE_META[z].label}</span>
                    <span className="text-right tabular-nums">{imp.toLocaleString()}</span>
                    <span className="text-right tabular-nums">{clk.toLocaleString()}</span>
                    <span className="text-right tabular-nums text-muted-foreground">{ctr}</span>
                  </div>
                );
              })
            )}
          </div>
          <p className="text-[10px] text-muted-foreground" style={bFont}>
            “Times shown” = how often the ad was seen by signed-in visitors. “Clicks” = how many tapped it. Counted from real visitors only.
          </p>
        </div>
      )}

      {/* ── NETWORKS ── */}
      {tab === "networks" && (
        <div className="space-y-4">
          <div className="border border-border rounded-sm p-4 space-y-3">
            <p className="text-xs font-semibold text-foreground" style={hFont}>Google AdSense (for the website)</p>
            <div><label className={label}>Your Publisher ID</label><input className={input} style={bFont} value={publisherId} onChange={(e) => setPublisherId(e.target.value)} placeholder="ca-pub-XXXXXXXXXXXXXXXX" /></div>
            <p className="text-[10px] text-muted-foreground" style={bFont}>You only enter this once. It lets any spot set to “Google ad” show Google ads on the website. (Inside the phone app, Google ads need AdMob — that comes later.)</p>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminAdsV2;
