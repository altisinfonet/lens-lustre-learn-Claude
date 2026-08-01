/**
 * AdCreativeLibrary — many pictures for one ad zone.
 *
 * Built for the owner's Story Card (feed) requirement: 50+ ad photos, a
 * different one at each in-feed position, rotating over time. The single
 * picture field in `ad_zones_v2` cannot express that, so these live in the
 * `ad_creatives` table (one row per picture).
 *
 * DESIGN NOTE — every action saves IMMEDIATELY.
 *   The rest of this panel uses a form + Save button, and the owner has twice
 *   lost work by uploading a picture and navigating away before pressing Save.
 *   Here, uploading, editing a link, switching a picture on/off and deleting
 *   each write straight to the database and confirm with a toast. There is no
 *   unsaved state to lose.
 *
 * The zone's own single picture is left completely alone. If this library is
 * empty the renderer falls back to it, so nothing that works today stops
 * working.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Upload, Trash2, ImageOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/core/use-toast";
import { compressImageToFiles } from "@/lib/imageCompression";
import { generateImagePath, uploadImage } from "@/lib/imageUpload";
import { invalidateAdCreatives } from "@/lib/ads/adCreatives";
import { feedAdSlotLabel } from "@/lib/ads/feedAdPlacement";
import type { AdZoneId } from "@/lib/ads/adZonesV2";

interface Row {
  id: string;
  zone: string;
  image_url: string;
  click_url: string;
  alt_text: string;
  is_active: boolean;
  sort_order: number;
}

const hFont = { fontFamily: "var(--font-heading)" };
const bFont = { fontFamily: "var(--font-body)" };
const input =
  "w-full bg-background border border-border rounded-sm px-2.5 py-1.5 text-[11px] text-foreground focus:outline-none focus:border-primary";

const AdCreativeLibrary = ({ zone }: { zone: AdZoneId }) => {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);
  const [tableMissing, setTableMissing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("ad_creatives" as never)
      .select("id, zone, image_url, click_url, alt_text, is_active, sort_order")
      .eq("zone", zone)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) {
      // The migration has not been run yet — say so plainly instead of
      // rendering an empty library that looks like "you have no pictures".
      setTableMissing(true);
      setRows([]);
      return;
    }
    setTableMissing(false);
    setRows((data as unknown as Row[]) || []);
  }, [zone]);

  useEffect(() => { void load(); }, [load]);

  /** Upload many files at once. Each becomes one picture in the library. */
  const onFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (e.target) e.target.value = "";
    if (!files.length) return;

    const images = files.filter((f) => f.type.startsWith("image/"));
    const skipped = files.length - images.length;
    if (!images.length) {
      toast({ title: "Please choose image files (jpg / png / webp)", variant: "destructive" });
      return;
    }

    setUploading({ done: 0, total: images.length });
    let added = 0;
    const failed: string[] = [];
    const base = (rows?.length ?? 0);

    for (let i = 0; i < images.length; i++) {
      const file = images[i];
      try {
        const { webpFile } = await compressImageToFiles(file, `ad-${zone}`, { maxDimension: 1600 });
        const path = generateImagePath({ type: "ad", ext: "webp" });
        const { url } = await uploadImage({
          bucket: "journal-images", file: webpFile, path, type: "ad", fileName: `ad-${zone}.webp`,
        });
        const { error } = await supabase.from("ad_creatives" as never).insert({
          zone, image_url: url, click_url: "", alt_text: "", is_active: true, sort_order: base + i,
        } as never);
        if (error) throw error;
        added++;
      } catch (err) {
        failed.push(file.name);
      }
      setUploading({ done: i + 1, total: images.length });
    }

    setUploading(null);
    invalidateAdCreatives();
    await load();

    // Report exactly what happened — never a blanket "done" that hides losses.
    if (added && !failed.length) {
      toast({ title: `${added} picture${added === 1 ? "" : "s"} added ✅` });
    } else if (added && failed.length) {
      toast({
        title: `${added} added, ${failed.length} failed`,
        description: `Not added: ${failed.slice(0, 3).join(", ")}${failed.length > 3 ? "…" : ""}`,
        variant: "destructive",
      });
    } else {
      toast({ title: "Nothing was added", description: failed[0] ? `Failed: ${failed[0]}` : undefined, variant: "destructive" });
    }
    if (skipped) toast({ title: `${skipped} file${skipped === 1 ? "" : "s"} skipped (not a picture)` });
  };

  const patch = async (id: string, values: Partial<Row>) => {
    setRows((prev) => (prev ? prev.map((r) => (r.id === id ? { ...r, ...values } : r)) : prev));
    const { error } = await supabase.from("ad_creatives" as never).update(values as never).eq("id", id);
    if (error) {
      toast({ title: "Could not save", description: error.message, variant: "destructive" });
      void load();
      return;
    }
    invalidateAdCreatives();
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("ad_creatives" as never).delete().eq("id", id);
    if (error) {
      toast({ title: "Could not remove", description: error.message, variant: "destructive" });
      return;
    }
    invalidateAdCreatives();
    setRows((prev) => (prev ? prev.filter((r) => r.id !== id) : prev));
    toast({ title: "Picture removed" });
  };

  const activeCount = rows?.filter((r) => r.is_active).length ?? 0;

  return (
    <div className="border border-primary/25 bg-primary/5 rounded-sm p-3 space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-[11px] font-semibold text-foreground" style={hFont}>Picture library — add as many ads as you like</p>
          <p className="text-[10px] text-muted-foreground" style={bFont}>
            Each picture has its <strong>own fixed place</strong> in the feed, shown beside it below. Add as many as you like —
            the deeper ones appear to people who scroll further. Changes here save on their own; there is no Save button to forget.
          </p>
        </div>
        <div className="text-[10px] text-muted-foreground shrink-0" style={bFont}>
          {rows === null ? "…" : <><strong className="text-foreground">{activeCount}</strong> on · {rows.length} total</>}
        </div>
      </div>

      {tableMissing && (
        <p className="text-[10px] text-destructive" style={bFont}>
          The picture library table is not in the database yet. Run migration
          <code className="mx-1">20260801100000_ad_creatives_library.sql</code> in the Supabase SQL editor, then reload this page.
        </p>
      )}

      <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={onFiles} />
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={!!uploading || tableMissing}
        className="inline-flex items-center gap-2 px-3 py-2 rounded-sm border border-primary/40 text-[11px] text-foreground hover:bg-primary/10 disabled:opacity-50"
        style={hFont}
      >
        {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
        {uploading ? `Uploading ${uploading.done} of ${uploading.total}…` : "Add pictures (choose many at once)"}
      </button>

      {rows !== null && rows.length === 0 && !tableMissing && (
        <p className="text-[10px] text-muted-foreground flex items-center gap-1.5" style={bFont}>
          <ImageOff className="h-3 w-3" /> No pictures yet — the single picture above is used until you add some.
        </p>
      )}

      {!!rows?.length && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {rows.map((r, i) => (
            <div key={r.id} className={`flex gap-2.5 p-2 rounded-sm border ${r.is_active ? "border-border bg-background" : "border-border/50 bg-muted/20 opacity-60"}`}>
              <img src={r.image_url} alt={r.alt_text || "Ad"} className="h-16 w-16 object-cover rounded-sm border border-border shrink-0 bg-muted/20" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex items-center gap-2">
                  {/* Exactly where THIS picture lands in the feed, generated
                      from the placement rule so it can never go stale. */}
                  <span className="text-[10px] text-primary shrink-0 font-medium" style={hFont}>
                    {zone === "story-card" ? feedAdSlotLabel(i) : `#${i + 1}`}
                  </span>
                  <label className="flex items-center gap-1.5 text-[10px] text-foreground cursor-pointer" style={bFont}>
                    <input type="checkbox" className="accent-primary" checked={r.is_active}
                      onChange={(e) => void patch(r.id, { is_active: e.target.checked })} />
                    {r.is_active ? "Showing" : "Hidden"}
                  </label>
                  <button type="button" onClick={() => void remove(r.id)}
                    className="ml-auto text-muted-foreground hover:text-destructive shrink-0" title="Remove this picture">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <input
                  className={input}
                  style={bFont}
                  defaultValue={r.click_url}
                  placeholder="Website to open when clicked (optional)"
                  onBlur={(e) => { if (e.target.value !== r.click_url) void patch(r.id, { click_url: e.target.value.trim() }); }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AdCreativeLibrary;
