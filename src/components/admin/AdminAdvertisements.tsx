import { useState, useEffect, useRef, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/core/use-toast";
import ConfirmDialog from "@/components/admin/ConfirmDialog";
import { useConfirmAction } from "@/hooks/admin/useConfirmAction";
import { Loader2, Save, Megaphone, Plus, Trash2, Eye, EyeOff, Monitor, Smartphone, Tablet, Upload, Link, Image as ImageIcon, Crop as CropIcon, BarChart3, Globe, Clock, Beaker, Settings2, Info, AlertTriangle } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import AdImagePositioner, { PLACEMENT_DIMENSIONS } from "@/components/admin/AdImagePositioner";
import { generateImagePath, uploadImage } from "@/lib/imageUpload";
import { compressImageToFiles } from "@/lib/imageCompression";
import { isS3Enabled } from "@/lib/s3Upload";
import type { User } from "@supabase/supabase-js";
import { invalidateAdSlotCache, invalidateAdsenseConfigCache, type AdSource } from "@/lib/adSlots";

// Extracted sub-components
import AdAdsenseTab from "./ads/AdAdsenseTab";
import AdAnalyticsTab from "./ads/AdAnalyticsTab";
import AdPlacementsTab from "./ads/AdPlacementsTab";
import AdminAdsV2 from "./ads/AdminAdsV2";
import {
  type AdSlot, type AdsenseConfig, type ImpressionAgg, type ConversionAgg,
  type Placement, type Device, type AdImageSource,
  placementOptions, deviceOptions, adsenseFormats, emptySlot, isValidUrl,
  headingFont, bodyFont, labelClass, inputClass,
} from "./ads/AdTypes";

export default function AdminAdvertisements({ user }: { user: User | null }) {
  const qc = useQueryClient();
  const [slots, setSlots] = useState<AdSlot[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("slots");
  const [editingSlot, setEditingSlot] = useState<AdSlot | null>(null);
  const [cropSrc, setCropSrc] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [previewDevice, setPreviewDevice] = useState<"desktop" | "mobile">("desktop");
  const [imagePlacement, setImagePlacement] = useState<string | null>(null);
  const { confirm: confirmAction, dialogProps } = useConfirmAction();

  const lastKnownUpdatedAt = useRef<string | null>(null);

  const [adsenseConfig, setAdsenseConfig] = useState<AdsenseConfig>({ publisher_id: "", enabled: false, auto_ads: false });
  const [savingAdsense, setSavingAdsense] = useState(false);
  const [conversions, setConversions] = useState<ConversionAgg[]>([]);

  const [feedAdPositions, setFeedAdPositions] = useState("1, 4, 14, 34, 54");
  const [savingPositions, setSavingPositions] = useState(false);

  const [impressions, setImpressions] = useState<ImpressionAgg[]>([]);
  const [analyticsRange, setAnalyticsRange] = useState<"7d" | "30d" | "90d">("7d");
  const [loadingAnalytics, setLoadingAnalytics] = useState(false);

  useEffect(() => {
    const fetchAll = async () => {
      const [slotsRes, adsenseRes, posRes] = await Promise.all([
        supabase.from("site_settings").select("value, updated_at").eq("key", "ad_slots").maybeSingle(),
        supabase.from("site_settings").select("value").eq("key", "adsense_config").maybeSingle(),
        supabase.from("site_settings").select("value").eq("key", "feed_ad_positions").maybeSingle(),
      ]);
      if (slotsRes.data?.value && Array.isArray(slotsRes.data.value)) {
        const defaults = emptySlot();
        setSlots((slotsRes.data.value as unknown as AdSlot[]).map(s => ({
          ...defaults,
          ...s,
          ad_source: (s.ad_source as AdSource) || "internal",
          image_source: (s.image_source as AdImageSource) || "upload",
        })));
      }
      if (slotsRes.data?.updated_at) {
        lastKnownUpdatedAt.current = slotsRes.data.updated_at as string;
      }
      if (adsenseRes.data?.value && typeof adsenseRes.data.value === "object") {
        const v = adsenseRes.data.value as Record<string, unknown>;
        setAdsenseConfig({
          publisher_id: (v.publisher_id as string) || "",
          enabled: v.enabled === true,
          auto_ads: v.auto_ads === true,
        });
      }
      if (posRes.data?.value && Array.isArray(posRes.data.value)) {
        setFeedAdPositions((posRes.data.value as number[]).join(", "));
      }
      setLoading(false);
    };
    fetchAll();
  }, []);

  // Keep lastKnownUpdatedAt in sync with realtime changes so the optimistic lock never falsely blocks saves
  useEffect(() => {
    const channel = supabase
      .channel("admin-ads-version-sync")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "site_settings" },
        (payload: any) => {
          const key = payload?.new?.key ?? payload?.old?.key;
          if (key === "ad_slots" && payload?.new?.updated_at) {
            lastKnownUpdatedAt.current = payload.new.updated_at as string;
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    if (activeTab !== "analytics") return;
    const fetchAnalytics = async () => {
      setLoadingAnalytics(true);
      const daysMap = { "7d": 7, "30d": 30, "90d": 90 };
      const since = new Date();
      since.setDate(since.getDate() - daysMap[analyticsRange]);
      const { data, error } = await supabase.rpc("get_ad_analytics", { _since: since.toISOString() });
      if (!error && data) {
        const result = data as unknown as { impressions: ImpressionAgg[]; conversions: ConversionAgg[] };
        setImpressions(result.impressions || []);
        setConversions(result.conversions || []);
      }
      setLoadingAnalytics(false);
    };
    fetchAnalytics();
  }, [activeTab, analyticsRange]);

  const saveSlots = async (updatedSlots: AdSlot[]) => {
    if (!user) return;
    setSaving(true);
    if (lastKnownUpdatedAt.current) {
      const { data: current } = await supabase.from("site_settings").select("updated_at").eq("key", "ad_slots").maybeSingle();
      if (current?.updated_at && current.updated_at !== lastKnownUpdatedAt.current) {
        setSaving(false);
        toast({ title: "Save blocked", description: "Ad data was updated in another tab or session. Please refresh to get the latest version.", variant: "destructive" });
        return;
      }
    }
    const now = new Date().toISOString();
    const { error } = await supabase.from("site_settings").upsert(
      { key: "ad_slots", value: updatedSlots as any, updated_at: now, updated_by: user.id },
      { onConflict: "key" }
    );
    setSaving(false);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
    } else {
      invalidateAdSlotCache();
      qc.invalidateQueries({ queryKey: ["dashboard-init"] });
      window.dispatchEvent(new CustomEvent("ad-slots-updated"));
      lastKnownUpdatedAt.current = now;
      setSlots(updatedSlots);
      toast({ title: "Ad slots saved" });
    }
  };

  const saveAdsenseConfig = async () => {
    if (!user) return;
    setSavingAdsense(true);
    const { error } = await supabase.from("site_settings").upsert(
      { key: "adsense_config", value: adsenseConfig as any, updated_at: new Date().toISOString(), updated_by: user.id },
      { onConflict: "key" }
    );
    setSavingAdsense(false);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
    } else {
      invalidateAdsenseConfigCache();
      qc.setQueryData(["site-setting", "adsense_config"], adsenseConfig);
      qc.invalidateQueries({ queryKey: ["dashboard-init"] });
      window.dispatchEvent(new CustomEvent("ad-slots-updated"));
      toast({ title: "AdSense configuration saved" });
    }
  };

  const saveFeedPositions = async () => {
    if (!user) return;
    const parsed = feedAdPositions.split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n) && n >= 0).sort((a, b) => a - b);
    if (parsed.length === 0) {
      toast({ title: "Invalid positions", description: "Enter comma-separated numbers (e.g. 1, 4, 14, 34)", variant: "destructive" });
      return;
    }
    setSavingPositions(true);
    const { error } = await supabase.from("site_settings").upsert(
      { key: "feed_ad_positions", value: parsed as any, updated_at: new Date().toISOString(), updated_by: user.id },
      { onConflict: "key" }
    );
    setSavingPositions(false);
    if (error) {
      toast({ title: "Save failed", description: error.message, variant: "destructive" });
    } else {
      setFeedAdPositions(parsed.join(", "));
      qc.setQueryData(["feed-ad-positions"], parsed);
      qc.invalidateQueries({ queryKey: ["dashboard-init"] });
      toast({ title: "Feed ad positions saved" });
    }
  };

  const addSlot = () => { setImagePlacement(null); setEditingSlot(emptySlot()); };
  const deleteSlot = (id: string) => saveSlots(slots.filter((s) => s.id !== id));
  const toggleSlot = (id: string) => saveSlots(slots.map((s) => (s.id === id ? { ...s, is_active: !s.is_active } : s)));

  const saveEditingSlot = () => {
    if (!editingSlot) return;
    if (!editingSlot.name.trim()) { toast({ title: "Please enter a slot name", variant: "destructive" }); return; }
    if (editingSlot.ad_source === "adsense" && !editingSlot.adsense_slot_id.trim()) { toast({ title: "Please enter AdSense slot ID", variant: "destructive" }); return; }
    if (editingSlot.devices.length === 0) { toast({ title: "Select at least one device", variant: "destructive" }); return; }
    const slotData = { ...editingSlot };
    if (slotData.ad_source === "adsense" && slotData.ab_enabled) slotData.ab_enabled = false;
    if (slotData.ad_source === "internal") {
      const source = slotData.image_source || "upload";
      if (source === "code" && !slotData.ad_code.trim()) { toast({ title: "Please enter the ad code/HTML", variant: "destructive" }); return; }
      if ((source === "upload" || source === "url") && !slotData.image_url?.trim()) { toast({ title: "Please provide an image", variant: "destructive" }); return; }
    }
    if (slotData.click_url?.trim() && !isValidUrl(slotData.click_url)) { toast({ title: "Invalid Click URL", description: "Must start with http:// or https://", variant: "destructive" }); return; }
    if (slotData.start_date && slotData.end_date && slotData.end_date < slotData.start_date) { toast({ title: "⚠️ End date is before start date", description: "This ad will never be shown. Please fix the schedule.", variant: "destructive" }); return; }
    if (!slotData.alt_text?.trim()) {
      const placementLabel = placementOptions.find(p => p.value === slotData.placement)?.label || slotData.placement;
      slotData.alt_text = `Ad - ${placementLabel}`;
    }
    const exists = slots.find((s) => s.id === slotData.id);
    const updated = exists ? slots.map((s) => (s.id === slotData.id ? slotData : s)) : [...slots, slotData];
    saveSlots(updated);
    setEditingSlot(null);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const warnings: string[] = [];
    if (file.size > 2 * 1024 * 1024) warnings.push(`File size is ${(file.size / 1024 / 1024).toFixed(1)}MB (>2MB)`);
    const requiredDim = editingSlot ? PLACEMENT_DIMENSIONS[editingSlot.placement] : null;
    if (requiredDim) {
      const img = new window.Image();
      img.onload = () => {
        if (img.naturalWidth < requiredDim.width) warnings.push(`Image width ${img.naturalWidth}px is less than required ${requiredDim.width}px`);
        const imgRatio = img.naturalWidth / img.naturalHeight;
        const targetRatio = requiredDim.width / requiredDim.height;
        const ratioDiff = Math.abs(imgRatio - targetRatio) / targetRatio;
        if (ratioDiff > 0.15) warnings.push(`Recommended ratio for this placement is ${requiredDim.width}×${requiredDim.height}. Your image may be cropped`);
        if (warnings.length > 0) toast({ title: "⚠️ Image may appear blurry or stretched", description: warnings.join(". "), variant: "destructive" });
        URL.revokeObjectURL(img.src);
      };
      img.src = URL.createObjectURL(file);
    } else if (warnings.length > 0) {
      toast({ title: "⚠️ Image may appear blurry or stretched", description: warnings.join(". "), variant: "destructive" });
    }
    setCropSrc(URL.createObjectURL(file));
    e.target.value = "";
  };

  const handleCropComplete = async (croppedFile: File) => {
    setCropSrc(null);
    if (!editingSlot || !user) return;
    setUploading(true);
    try {
      const baseName = `ads/${editingSlot.id}-${Date.now()}`;
      const { webpFile } = await compressImageToFiles(croppedFile, baseName.split("/").pop(), { maxDimension: 1920, webpQuality: 0.8 });
      const path = generateImagePath({ type: "ad", ext: "webp" });

      let url: string;
      const useExternalStorage = await isS3Enabled().catch(() => false);
      if (useExternalStorage) {
        const formData = new FormData();
        formData.append("file", webpFile, webpFile.name);
        formData.append("path", `journal-images/${path}`);
        formData.append("private", "false");

        const { data, error } = await supabase.functions.invoke("s3-upload", { body: formData });
        if (error || data?.error || !data?.url) {
          throw new Error(data?.detail || data?.error || error?.message || "Upload failed");
        }
        url = data.url as string;
      } else {
        const result = await uploadImage({ bucket: "journal-images", file: webpFile, path, type: "ad" });
        url = result.url;
      }

      setEditingSlot({ ...editingSlot, image_url: url, image_source: "upload" });
      setImagePlacement(editingSlot.placement);
      toast({ title: "Image compressed & uploaded (WebP)" });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    }
    setUploading(false);
  };

  const toggleDevice = (device: Device) => {
    if (!editingSlot) return;
    const devices = editingSlot.devices.includes(device) ? editingSlot.devices.filter((d) => d !== device) : [...editingSlot.devices, device];
    setEditingSlot({ ...editingSlot, devices });
  };

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }

  const activeSlots = slots.filter((s) => s.is_active);

  return (
    <div>
      <div className="flex items-center gap-3 mb-8">
        <Megaphone className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-light" style={{ fontFamily: "var(--font-display)" }}>
          Advertisement <em className="italic text-primary">Manager</em>
        </h2>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-card border border-border mb-8 flex-wrap">
          <TabsTrigger value="slots" className="text-[10px] tracking-[0.15em] uppercase data-[state=active]:bg-primary data-[state=active]:text-primary-foreground" style={headingFont}>
            <Megaphone className="h-3.5 w-3.5 mr-1.5" /> Ad Slots
          </TabsTrigger>
          <TabsTrigger value="adsense" className="text-[10px] tracking-[0.15em] uppercase data-[state=active]:bg-primary data-[state=active]:text-primary-foreground" style={headingFont}>
            <Settings2 className="h-3.5 w-3.5 mr-1.5" /> AdSense Config
          </TabsTrigger>
          <TabsTrigger value="analytics" className="text-[10px] tracking-[0.15em] uppercase data-[state=active]:bg-primary data-[state=active]:text-primary-foreground" style={headingFont}>
            <BarChart3 className="h-3.5 w-3.5 mr-1.5" /> Analytics
          </TabsTrigger>
          <TabsTrigger value="placements" className="text-[10px] tracking-[0.15em] uppercase data-[state=active]:bg-primary data-[state=active]:text-primary-foreground" style={headingFont}>
            <Monitor className="h-3.5 w-3.5 mr-1.5" /> Placements
          </TabsTrigger>
          <TabsTrigger value="zones_v2" className="text-[10px] tracking-[0.15em] uppercase data-[state=active]:bg-primary data-[state=active]:text-primary-foreground" style={headingFont}>
            <Monitor className="h-3.5 w-3.5 mr-1.5" /> Ad Zones (New)
          </TabsTrigger>
        </TabsList>

        {/* ─── AD SLOTS TAB (kept inline — tightly coupled with editing state) ─── */}
        <TabsContent value="slots">
          {editingSlot ? (
            <div className="border border-border p-6 space-y-5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs tracking-[0.2em] uppercase text-primary" style={headingFont}>
                  {slots.find((s) => s.id === editingSlot.id) ? "Edit Ad Slot" : "New Ad Slot"}
                </span>
                <button onClick={() => setEditingSlot(null)} className="text-muted-foreground hover:text-foreground text-xs" style={headingFont}>Cancel</button>
              </div>

              {/* Basic Info */}
              <div className="grid md:grid-cols-2 gap-5">
                <div>
                  <label className={labelClass} style={headingFont}>Slot Name *</label>
                  <input value={editingSlot.name} onChange={(e) => setEditingSlot({ ...editingSlot, name: e.target.value })} className={inputClass} style={bodyFont} placeholder="e.g. Homepage Top Banner" />
                </div>
                <div>
                  <label className={labelClass} style={headingFont}>Placement</label>
                  <select value={editingSlot.placement} onChange={(e) => {
                    const newPlacement = e.target.value as Placement;
                    const hadImage = editingSlot.image_url && imagePlacement && imagePlacement !== newPlacement;
                    if (hadImage) {
                      setEditingSlot({ ...editingSlot, placement: newPlacement, image_url: "", image_source: "upload" });
                      setImagePlacement(null);
                      toast({ title: "⚠️ Image reset", description: "The previous image was cropped for a different placement. Please re-upload." });
                    } else {
                      setEditingSlot({ ...editingSlot, placement: newPlacement });
                    }
                  }} className={inputClass} style={bodyFont}>
                    {placementOptions.map((p) => (<option key={p.value} value={p.value}>{p.label}</option>))}
                  </select>
                  {editingSlot.image_url && imagePlacement && imagePlacement !== editingSlot.placement && (
                    <p className="text-[10px] text-destructive mt-1 flex items-center gap-1" style={bodyFont}>
                      <AlertTriangle className="h-3 w-3 shrink-0" />
                      This image was created for a different placement. Please re-upload.
                    </p>
                  )}
                </div>
                <div>
                  <label className={labelClass} style={headingFont}>Priority (0 = highest)</label>
                  <input type="number" value={editingSlot.priority} onChange={(e) => setEditingSlot({ ...editingSlot, priority: parseInt(e.target.value) || 0 })} className={inputClass} style={bodyFont} />
                  <p className="text-[9px] text-muted-foreground/60 mt-1" style={bodyFont}>Controls display order when multiple ads match</p>
                </div>
                <div>
                  <label className={labelClass} style={headingFont}>Status</label>
                  <button type="button" onClick={() => setEditingSlot({ ...editingSlot, is_active: !editingSlot.is_active })} className={`flex items-center gap-2 py-2.5 text-sm ${editingSlot.is_active ? "text-primary" : "text-muted-foreground"}`} style={bodyFont}>
                    {editingSlot.is_active ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                    {editingSlot.is_active ? "Active" : "Inactive"}
                  </button>
                </div>
              </div>

              {/* Ad Source Toggle */}
              <div>
                <label className={labelClass} style={headingFont}>Ad Source</label>
                <div className="flex gap-3">
                  {([
                    { value: "internal" as AdSource, label: "Internal Ad", icon: ImageIcon },
                    { value: "adsense" as AdSource, label: "Google AdSense", icon: Globe },
                  ]).map(({ value, label, icon: Icon }) => (
                    <button key={value} type="button" onClick={() => setEditingSlot({ ...editingSlot, ad_source: value })}
                      className={`flex items-center gap-2 px-4 py-2.5 border text-xs tracking-[0.1em] uppercase transition-all ${editingSlot.ad_source === value ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-foreground/30"}`}
                      style={headingFont}>
                      <Icon className="h-3.5 w-3.5" /> {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Placement requirements */}
              {(() => {
                const hints: Record<Placement, { hint: string; recommended: string; layout: React.ReactNode }> = {
                  header: { hint: "Top banner — full width above content", recommended: "1920 × 180 px · Ratio ~10.67:1 (Wide Leaderboard)", layout: <div className="w-full space-y-1"><div className="h-2.5 bg-primary/30 rounded-[2px]" /><div className="h-6 bg-muted-foreground/10 rounded-[2px]" /><div className="h-6 bg-muted-foreground/10 rounded-[2px]" /></div> },
                  sidebar: { hint: "Right side panel — beside content (max 300px)", recommended: "300 × 300 px · Ratio 1:1 (Square)", layout: <div className="w-full flex gap-1"><div className="flex-1 space-y-1"><div className="h-4 bg-muted-foreground/10 rounded-[2px]" /><div className="h-4 bg-muted-foreground/10 rounded-[2px]" /></div><div className="w-5 bg-primary/30 rounded-[2px]" /></div> },
                  "in-content": { hint: "Inside content — matches wall post size", recommended: "1080 × 1350 px · Ratio 4:5 (Post)", layout: <div className="w-full space-y-1"><div className="h-3 bg-muted-foreground/10 rounded-[2px]" /><div className="h-5 bg-primary/30 rounded-[2px] mx-auto w-2/3" /><div className="h-3 bg-muted-foreground/10 rounded-[2px]" /></div> },
                  "between-entries": { hint: "Between posts — matches wall post size", recommended: "1080 × 1350 px · Ratio 4:5 (Post)", layout: <div className="w-full space-y-1"><div className="h-3 bg-muted-foreground/10 rounded-[2px]" /><div className="h-5 bg-primary/30 rounded-[2px]" /><div className="h-3 bg-muted-foreground/10 rounded-[2px]" /></div> },
                  "above-journal": { hint: "Above journal section (full width)", recommended: "1200 × 250 px · Ratio ~5:1 (Banner)", layout: <div className="w-full space-y-1"><div className="h-2.5 bg-primary/30 rounded-[2px]" /><div className="h-6 bg-muted-foreground/10 rounded-[2px]" /></div> },
                  "below-journal": { hint: "Below journal section (full width)", recommended: "1200 × 250 px · Ratio ~5:1 (Banner)", layout: <div className="w-full space-y-1"><div className="h-6 bg-muted-foreground/10 rounded-[2px]" /><div className="h-2.5 bg-primary/30 rounded-[2px]" /></div> },
                  "lightbox-overlay": { hint: "Compact strip inside lightbox (full width, max-h 100px)", recommended: "900 × 100 px · Ratio 9:1 (Compact Strip)", layout: <div className="w-full border border-muted-foreground/10 rounded-[2px] p-1 flex items-end"><div className="flex-1 h-6 bg-muted-foreground/10 rounded-[2px]" /><div className="absolute bottom-1 left-1 right-1 h-1.5 bg-primary/30 rounded-[2px]" /></div> },
                  "anchor-bottom": { hint: "Fixed sticky bar at bottom of viewport", recommended: "728 × 90 px · Ratio ~8:1 (Leaderboard)", layout: <div className="w-full space-y-1"><div className="h-8 bg-muted-foreground/10 rounded-[2px]" /><div className="h-2 bg-primary/30 rounded-[2px]" /></div> },
                };
                const info = hints[editingSlot.placement];
                return (
                  <div className="flex items-stretch gap-4 px-3 py-3 rounded-sm bg-primary/5 border border-primary/20">
                    <div className="flex-1 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className="text-[9px] tracking-[0.15em] uppercase text-primary" style={headingFont}>Required size:</span>
                        <span className="text-[10px] text-foreground font-medium" style={headingFont}>{PLACEMENT_DIMENSIONS[editingSlot.placement]?.label || "—"}</span>
                      </div>
                      <p className="text-[10px] text-muted-foreground" style={bodyFont}>{info?.hint}</p>
                      <p className="text-[9px] text-primary/70" style={headingFont}>Recommended: {info?.recommended}</p>
                    </div>
                    <div className="w-24 shrink-0 relative flex flex-col justify-center">{info?.layout}</div>
                  </div>
                );
              })()}

              {/* AdSense-specific fields */}
              {editingSlot.ad_source === "adsense" && (
                <div className="border border-primary/20 rounded-sm bg-primary/5 p-5 space-y-4">
                  <div className="flex items-center gap-2 text-[10px] tracking-[0.2em] uppercase text-primary" style={headingFont}><Globe className="h-3.5 w-3.5" /> Google AdSense Unit</div>
                  {!adsenseConfig.publisher_id && (
                    <div className="text-[11px] text-destructive bg-destructive/10 border border-destructive/20 rounded-sm px-3 py-2" style={bodyFont}>⚠ No Publisher ID configured. Go to the "AdSense Config" tab first.</div>
                  )}
                  <div className="grid md:grid-cols-2 gap-4">
                    <div>
                      <label className={labelClass} style={headingFont}>Ad Slot ID *</label>
                      <input value={editingSlot.adsense_slot_id} onChange={(e) => setEditingSlot({ ...editingSlot, adsense_slot_id: e.target.value })} className={inputClass} style={bodyFont} placeholder="1234567890" />
                      <p className="text-[10px] text-muted-foreground mt-1" style={bodyFont}>Find this in your AdSense dashboard → Ad units</p>
                    </div>
                    <div>
                      <label className={labelClass} style={headingFont}>Responsive Format</label>
                      <select value={editingSlot.adsense_format} onChange={(e) => setEditingSlot({ ...editingSlot, adsense_format: e.target.value })} className={inputClass} style={bodyFont}>
                        {adsenseFormats.map((f) => (<option key={f.value} value={f.value}>{f.label}</option>))}
                      </select>
                    </div>
                  </div>
                </div>
              )}

              {/* Internal ad creative */}
              {editingSlot.ad_source === "internal" && (
                <div>
                  <label className={labelClass} style={headingFont}>Ad Creative Type</label>
                  <div className="flex gap-3 mb-4">
                    {([
                      { value: "upload" as AdImageSource, label: "Upload Image", icon: Upload },
                      { value: "url" as AdImageSource, label: "Image URL", icon: Link },
                      { value: "code" as AdImageSource, label: "HTML / Code", icon: CropIcon },
                    ]).map(({ value, label, icon: Icon }) => (
                      <button key={value} type="button" onClick={() => setEditingSlot({ ...editingSlot, image_source: value })}
                        className={`flex items-center gap-2 px-4 py-2.5 border text-xs tracking-[0.1em] uppercase transition-all ${(editingSlot.image_source || "upload") === value ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-foreground/30"}`}
                        style={headingFont}>
                        <Icon className="h-3.5 w-3.5" /> {label}
                      </button>
                    ))}
                  </div>

                  {(editingSlot.image_source === "upload" || !editingSlot.image_source) && editingSlot.image_source !== "code" && editingSlot.image_source !== "url" && (
                    <div className="space-y-4">
                      <div className="border border-dashed border-border rounded-sm p-5 bg-muted/10">
                        <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileSelect} className="hidden" />
                        <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading}
                          className="inline-flex items-center gap-2 px-5 py-2.5 border border-border text-xs tracking-[0.15em] uppercase hover:border-primary hover:text-primary transition-all disabled:opacity-50" style={headingFont}>
                          {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                          {uploading ? "Uploading…" : "Choose & Position Image"}
                        </button>
                        <p className="mt-2 text-[9px] text-muted-foreground/60">Upload any image — you'll position & zoom it to fit the required frame</p>
                      </div>
                      {editingSlot.image_url && (
                        <div className="border border-border rounded-sm p-3 space-y-3">
                          <p className="text-[9px] tracking-[0.2em] uppercase text-muted-foreground" style={headingFont}>Live Preview</p>
                          <div className="bg-muted border border-dashed border-border/50 rounded-sm p-2 flex justify-center overflow-x-auto">
                            <img loading="lazy" decoding="async" src={editingSlot.image_url} alt="Ad preview" className="max-w-full h-auto object-cover rounded-sm" />
                          </div>
                          <button type="button" onClick={() => setEditingSlot({ ...editingSlot, image_url: "" })} className="text-[9px] tracking-wider uppercase text-destructive hover:underline" style={headingFont}>Remove</button>
                        </div>
                      )}
                      <div className="grid md:grid-cols-2 gap-4">
                        <div>
                          <label className={labelClass} style={headingFont}>Click URL</label>
                          <input value={editingSlot.click_url || ""} onChange={(e) => setEditingSlot({ ...editingSlot, click_url: e.target.value })} className={`${inputClass} ${!editingSlot.click_url?.trim() ? "border-yellow-500/60" : editingSlot.click_url?.trim() && !isValidUrl(editingSlot.click_url) ? "border-destructive" : ""}`} style={bodyFont} placeholder="https://..." />
                          {!editingSlot.click_url?.trim() && <p className="text-[10px] text-yellow-600 dark:text-yellow-400 mt-1.5" style={bodyFont}>⚠️ This ad will not be clickable.</p>}
                          {editingSlot.click_url?.trim() && !isValidUrl(editingSlot.click_url) && <p className="text-[10px] text-destructive mt-1.5" style={bodyFont}>Enter a valid URL (https://...)</p>}
                        </div>
                        <div>
                          <label className={labelClass} style={headingFont}>Alt Text</label>
                          <input value={editingSlot.alt_text || ""} onChange={(e) => setEditingSlot({ ...editingSlot, alt_text: e.target.value })} className={inputClass} style={bodyFont} placeholder="Describe this ad for accessibility" />
                        </div>
                      </div>
                    </div>
                  )}

                  {editingSlot.image_source === "url" && (
                    <div className="space-y-4">
                      <div>
                        <label className={labelClass} style={headingFont}>Image URL *</label>
                        <input value={editingSlot.image_url || ""} onChange={(e) => setEditingSlot({ ...editingSlot, image_url: e.target.value })} className={inputClass} style={bodyFont} placeholder="https://..." />
                      </div>
                      {editingSlot.image_url && (
                        <div className="border border-border rounded-sm p-3">
                          <img loading="lazy" decoding="async" src={editingSlot.image_url} alt="Preview" className="max-w-full h-auto object-cover rounded-sm" onError={(e) => (e.currentTarget.style.display = "none")} />
                        </div>
                      )}
                      <div className="grid md:grid-cols-2 gap-4">
                        <div>
                          <label className={labelClass} style={headingFont}>Click URL</label>
                          <input value={editingSlot.click_url || ""} onChange={(e) => setEditingSlot({ ...editingSlot, click_url: e.target.value })} className={`${inputClass} ${!editingSlot.click_url?.trim() ? "border-yellow-500/60" : editingSlot.click_url?.trim() && !isValidUrl(editingSlot.click_url) ? "border-destructive" : ""}`} style={bodyFont} placeholder="https://..." />
                        </div>
                        <div>
                          <label className={labelClass} style={headingFont}>Alt Text</label>
                          <input value={editingSlot.alt_text || ""} onChange={(e) => setEditingSlot({ ...editingSlot, alt_text: e.target.value })} className={inputClass} style={bodyFont} placeholder="Describe this ad" />
                        </div>
                      </div>
                    </div>
                  )}

                  {editingSlot.image_source === "code" && (
                    <div>
                      <label className={labelClass} style={headingFont}>Ad Code / HTML *</label>
                      <textarea value={editingSlot.ad_code} onChange={(e) => setEditingSlot({ ...editingSlot, ad_code: e.target.value })} className={`${inputClass} resize-none border border-border rounded-sm p-3 font-mono`} rows={6} placeholder={'<!-- Paste your ad code here -->'} />
                    </div>
                  )}
                </div>
              )}

              {/* Creative Copy */}
              {editingSlot.ad_source === "internal" && editingSlot.image_source !== "code" && (
                <div className="border border-border rounded-sm p-5 space-y-4">
                  <div className="flex items-center gap-2">
                    <Megaphone className="h-4 w-4 text-primary" />
                    <span className="text-[10px] tracking-[0.2em] uppercase text-foreground" style={headingFont}>Creative Copy (Optional)</span>
                  </div>
                  <div className="grid md:grid-cols-3 gap-4">
                    <div>
                      <label className={labelClass} style={headingFont}>Headline (max 6 words)</label>
                      <input value={editingSlot.creative_headline || ""} onChange={(e) => { const words = e.target.value.split(/\s+/).filter(Boolean); if (words.length <= 6) setEditingSlot({ ...editingSlot, creative_headline: e.target.value }); }} className={inputClass} style={bodyFont} placeholder="e.g. Boost Sales Today" />
                    </div>
                    <div>
                      <label className={labelClass} style={headingFont}>Subtext (1 line)</label>
                      <input value={editingSlot.creative_subtext || ""} onChange={(e) => setEditingSlot({ ...editingSlot, creative_subtext: e.target.value })} className={inputClass} style={bodyFont} placeholder="e.g. Limited time offer" maxLength={80} />
                    </div>
                    <div>
                      <label className={labelClass} style={headingFont}>CTA Button Text</label>
                      <input value={editingSlot.creative_cta || ""} onChange={(e) => setEditingSlot({ ...editingSlot, creative_cta: e.target.value })} className={inputClass} style={bodyFont} placeholder="e.g. Get Started" maxLength={20} />
                    </div>
                  </div>
                  <div>
                    <p className="text-[9px] tracking-[0.15em] uppercase text-muted-foreground mb-2" style={headingFont}>Quick suggestions</p>
                    <div className="flex flex-wrap gap-2">
                      {([
                        { h: "Boost Sales Today", s: "Grow your business with us", c: "Get Started" },
                        { h: "Start Your Website", s: "Professional design in minutes", c: "Try Free" },
                        { h: "Get Clients Now", s: "Reach thousands of customers", c: "Learn More" },
                        { h: "Limited Time Offer", s: "Don't miss this exclusive deal", c: "Claim Now" },
                      ]).map((sug) => (
                        <button key={sug.h} type="button"
                          onClick={() => setEditingSlot({ ...editingSlot, creative_headline: sug.h, creative_subtext: sug.s, creative_cta: sug.c })}
                          className="text-[8px] tracking-wider uppercase px-2.5 py-1 border border-border text-muted-foreground hover:border-primary hover:text-primary transition-all rounded-sm" style={headingFont}>
                          {sug.h}
                        </button>
                      ))}
                    </div>
                  </div>
                  {(editingSlot.creative_headline || editingSlot.creative_subtext || editingSlot.creative_cta) && (
                    <div className="border border-primary/20 rounded-sm bg-primary/5 p-4">
                      <div className="bg-card border border-border rounded-sm p-5 text-center space-y-2 max-w-sm mx-auto">
                        {editingSlot.creative_headline && <p className="text-base font-semibold text-foreground" style={headingFont}>{editingSlot.creative_headline}</p>}
                        {editingSlot.creative_subtext && <p className="text-xs text-muted-foreground" style={bodyFont}>{editingSlot.creative_subtext}</p>}
                        {editingSlot.creative_cta && <span className="inline-block mt-1 px-4 py-1.5 bg-primary text-primary-foreground text-[10px] tracking-[0.15em] uppercase rounded-sm" style={headingFont}>{editingSlot.creative_cta}</span>}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* A/B Testing */}
              <div className={`border border-border rounded-sm p-5 space-y-4 ${editingSlot.ad_source === "adsense" ? "opacity-50 pointer-events-none" : ""}`}>
                <div className="flex items-center gap-2">
                  <Beaker className="h-4 w-4 text-primary" />
                  <span className="text-[10px] tracking-[0.2em] uppercase text-foreground" style={headingFont}>A/B Testing</span>
                  {editingSlot.ad_source === "adsense" ? (
                    <span className="ml-auto text-[9px] tracking-wider uppercase px-3 py-1 border border-border text-muted-foreground" style={headingFont}>Not available for AdSense</span>
                  ) : (
                    <button type="button" onClick={() => setEditingSlot({ ...editingSlot, ab_enabled: !editingSlot.ab_enabled })}
                      className={`ml-auto text-[9px] tracking-wider uppercase px-3 py-1 border transition-all ${editingSlot.ab_enabled ? "border-primary text-primary bg-primary/10" : "border-border text-muted-foreground"}`} style={headingFont}>
                      {editingSlot.ab_enabled ? "Enabled" : "Disabled"}
                    </button>
                  )}
                </div>
                {editingSlot.ab_enabled && editingSlot.ad_source !== "adsense" && (
                  <div>
                    <label className={labelClass} style={headingFont}>AdSense traffic % (rest goes to internal)</label>
                    <div className="flex items-center gap-4">
                      <input type="range" min={0} max={100} value={editingSlot.ab_adsense_pct}
                        onChange={(e) => setEditingSlot({ ...editingSlot, ab_adsense_pct: parseInt(e.target.value) })}
                        className="flex-1 accent-primary" />
                      <span className="text-sm text-foreground w-16 text-center" style={bodyFont}>{editingSlot.ab_adsense_pct}% AdSense</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-1" style={bodyFont}>{100 - editingSlot.ab_adsense_pct}% internal · {editingSlot.ab_adsense_pct}% AdSense</p>
                  </div>
                )}
              </div>

              {/* Schedule */}
              <div className="grid md:grid-cols-2 gap-5">
                <div><label className={labelClass} style={headingFont}>Start Date</label><input type="date" value={editingSlot.start_date} onChange={(e) => setEditingSlot({ ...editingSlot, start_date: e.target.value })} className={inputClass} style={bodyFont} /></div>
                <div><label className={labelClass} style={headingFont}>End Date</label><input type="date" value={editingSlot.end_date} onChange={(e) => setEditingSlot({ ...editingSlot, end_date: e.target.value })} className={inputClass} style={bodyFont} /></div>
              </div>

              {/* Hour targeting */}
              <div className="border border-border rounded-sm p-5 space-y-3">
                <div className="flex items-center gap-2"><Clock className="h-4 w-4 text-primary" /><span className="text-[10px] tracking-[0.2em] uppercase text-foreground" style={headingFont}>Hour-of-Day Targeting</span></div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div><label className={labelClass} style={headingFont}>Start Hour (0-23)</label><input type="number" min={0} max={23} value={editingSlot.schedule_hours_start} onChange={(e) => setEditingSlot({ ...editingSlot, schedule_hours_start: parseInt(e.target.value) || 0 })} className={inputClass} style={bodyFont} /></div>
                  <div><label className={labelClass} style={headingFont}>End Hour (1-24)</label><input type="number" min={1} max={24} value={editingSlot.schedule_hours_end} onChange={(e) => setEditingSlot({ ...editingSlot, schedule_hours_end: parseInt(e.target.value) || 24 })} className={inputClass} style={bodyFont} /></div>
                </div>
              </div>

              {/* Revenue Rates */}
              <div className="border border-border rounded-sm p-5 space-y-3">
                <div className="flex items-center gap-2"><BarChart3 className="h-4 w-4 text-primary" /><span className="text-[10px] tracking-[0.2em] uppercase text-foreground" style={headingFont}>Revenue Rates</span></div>
                <div className="grid grid-cols-2 gap-4">
                  <div><label className={labelClass} style={headingFont}>CPM Rate (₹ per 1000 impressions)</label><input type="number" min={0} step={0.01} value={editingSlot.cpm_rate || 0} onChange={(e) => setEditingSlot({ ...editingSlot, cpm_rate: parseFloat(e.target.value) || 0 })} className={inputClass} style={bodyFont} /></div>
                  <div><label className={labelClass} style={headingFont}>CPC Rate (₹ per click)</label><input type="number" min={0} step={0.01} value={editingSlot.cpc_rate || 0} onChange={(e) => setEditingSlot({ ...editingSlot, cpc_rate: parseFloat(e.target.value) || 0 })} className={inputClass} style={bodyFont} /></div>
                </div>
              </div>

              {/* Device Targeting */}
              <div>
                <label className={labelClass} style={headingFont}>Target Devices</label>
                <div className="flex gap-3">
                  {([
                    { value: "desktop" as Device, label: "Desktop", icon: Monitor },
                    { value: "mobile" as Device, label: "Mobile", icon: Smartphone },
                    { value: "tablet" as Device, label: "Tablet", icon: Tablet },
                  ]).map(({ value, label, icon: Icon }) => (
                    <button key={value} type="button" onClick={() => toggleDevice(value)}
                      className={`flex items-center gap-2 px-4 py-2.5 border text-xs tracking-[0.1em] uppercase transition-all ${editingSlot.devices.includes(value) ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:border-foreground/30"}`}
                      style={headingFont}>
                      <Icon className="h-3.5 w-3.5" /> {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className={labelClass} style={headingFont}>Notes (optional)</label>
                <input value={editingSlot.notes} onChange={(e) => setEditingSlot({ ...editingSlot, notes: e.target.value })} className={inputClass} style={bodyFont} placeholder="Internal notes..." />
              </div>

              {/* Image Positioner Modal */}
              {cropSrc && <AdImagePositioner imageSrc={cropSrc} placement={editingSlot.placement} onComplete={handleCropComplete} onCancel={() => setCropSrc(null)} />}

              <div className="flex gap-3 pt-2">
                <button onClick={saveEditingSlot} disabled={saving}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground text-xs tracking-[0.15em] uppercase hover:opacity-90 transition-opacity disabled:opacity-50" style={headingFont}>
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save Ad Slot
                </button>
                <button onClick={() => setEditingSlot(null)} className="px-5 py-2.5 border border-border text-xs tracking-[0.15em] uppercase text-muted-foreground hover:text-foreground transition-colors" style={headingFont}>Cancel</button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-[9px] tracking-[0.3em] uppercase text-muted-foreground" style={headingFont}>
                  {slots.length} slot{slots.length !== 1 ? "s" : ""} · {activeSlots.length} active
                </span>
                <button onClick={addSlot} className="inline-flex items-center gap-2 px-4 py-2 text-xs tracking-[0.15em] uppercase border border-border hover:border-primary hover:text-primary transition-all" style={headingFont}>
                  <Plus className="h-3.5 w-3.5" /> New Ad Slot
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {([
                  { label: "Create Header Ad", placement: "header" as Placement, name: "Header Banner", cpm: 40 },
                  { label: "Create Sidebar Ad", placement: "sidebar" as Placement, name: "Sidebar Rectangle", cpm: 180 },
                  { label: "Create Content Ad", placement: "in-content" as Placement, name: "In-Content Ad", cpm: 120 },
                ] as const).map((tpl) => (
                  <button key={tpl.placement} type="button"
                    onClick={() => { setImagePlacement(null); setEditingSlot({ ...emptySlot(), name: tpl.name, placement: tpl.placement, cpm_rate: tpl.cpm, image_source: "upload" }); }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[9px] tracking-[0.12em] uppercase border border-primary/30 text-primary/80 hover:bg-primary/10 hover:border-primary transition-all rounded-sm" style={headingFont}>
                    <Plus className="h-3 w-3" /> {tpl.label}
                  </button>
                ))}
              </div>
              {slots.length === 0 ? (
                <div className="text-center py-16 border border-dashed border-border">
                  <Megaphone className="h-8 w-8 text-muted-foreground/30 mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground" style={bodyFont}>No ad slots created yet.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {slots.sort((a, b) => a.priority - b.priority).map((slot) => (
                    <div key={slot.id} className={`border p-4 flex items-center justify-between transition-colors ${slot.is_active ? "border-border" : "border-border/40 opacity-60"}`}>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <span className="text-sm font-medium truncate" style={bodyFont}>{slot.name}</span>
                          <span className={`text-[9px] tracking-[0.15em] uppercase px-2 py-0.5 border ${slot.is_active ? "border-primary/40 text-primary" : "border-border text-muted-foreground"}`} style={headingFont}>
                            {slot.is_active ? "Active" : "Inactive"}
                          </span>
                          <span className={`text-[9px] tracking-[0.15em] uppercase px-2 py-0.5 border ${slot.ad_source === "adsense" ? "border-blue-400/40 text-blue-500" : "border-border text-muted-foreground"}`} style={headingFont}>
                            {slot.ad_source === "adsense" ? "AdSense" : "Internal"}
                          </span>
                          {slot.ab_enabled && <span className="text-[9px] tracking-[0.15em] uppercase px-2 py-0.5 border border-amber-400/40 text-amber-500" style={headingFont}>A/B</span>}
                        </div>
                        <div className="flex items-center gap-3 text-[10px] text-muted-foreground flex-wrap" style={bodyFont}>
                          <span className="uppercase tracking-wider">{placementOptions.find((p) => p.value === slot.placement)?.label}</span>
                          {slot.start_date && <span>· From {slot.start_date}</span>}
                          {slot.end_date && <span>to {slot.end_date}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 ml-4">
                        <button onClick={() => toggleSlot(slot.id)} className="text-muted-foreground hover:text-foreground transition-colors p-1" title={slot.is_active ? "Deactivate" : "Activate"}>
                          {slot.is_active ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                        </button>
                        <button onClick={() => { setImagePlacement(slot.image_url ? slot.placement : null); setEditingSlot({ ...slot }); }} className="text-muted-foreground hover:text-primary transition-colors p-1" title="Edit">
                          <Megaphone className="h-4 w-4" />
                        </button>
                        <button onClick={() => confirmAction({ title: `Delete "${slot.name}"?`, onConfirm: () => deleteSlot(slot.id) })} className="text-muted-foreground hover:text-destructive transition-colors p-1" title="Delete">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </TabsContent>

        {/* ─── EXTRACTED TABS ─── */}
        <TabsContent value="adsense">
          <AdAdsenseTab config={adsenseConfig} onChange={setAdsenseConfig} onSave={saveAdsenseConfig} saving={savingAdsense} />
        </TabsContent>

        <TabsContent value="analytics">
          <AdAnalyticsTab slots={slots} impressions={impressions} conversions={conversions} analyticsRange={analyticsRange} onRangeChange={setAnalyticsRange} loading={loadingAnalytics} />
        </TabsContent>

        <TabsContent value="placements">
          <AdPlacementsTab slots={slots} feedAdPositions={feedAdPositions} onFeedAdPositionsChange={setFeedAdPositions} onSaveFeedPositions={saveFeedPositions} savingPositions={savingPositions} />
        </TabsContent>

        <TabsContent value="zones_v2">
          <AdminAdsV2 />
        </TabsContent>
      </Tabs>
      <ConfirmDialog {...dialogProps} />
    </div>
  );
}
