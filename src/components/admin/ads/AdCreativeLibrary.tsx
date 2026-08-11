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
import { Loader2, Upload, Trash2, ImageOff, Copy, ExternalLink } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/core/use-toast";
import { compressImageToFiles } from "@/lib/imageCompression";
import { generateImagePath, uploadImage } from "@/lib/imageUpload";
import { invalidateAdCreatives } from "@/lib/ads/adCreatives";
import { adPath } from "@/lib/ads/adEngagement";
import { publicUrl } from "@/lib/publicUrl";
import { feedAdSlotLabel } from "@/lib/ads/feedAdPlacement";
import type { AdZoneId } from "@/lib/ads/adZonesV2";

interface Row {
  id: string;
  zone: string;
  image_url: string;
  click_url: string;
  alt_text: string;
  /**
   * THE PUBLISHER OF THIS ONE PICTURE. Owner, 2026-08-10: "story feed have 16
   * ads then 16 publishers name will have with logo" — so both of these live on
   * the PICTURE, not on the zone. Sixteen pictures, sixteen publishers.
   *
   * These two fields must stay in the `select` in `load()` below. They were
   * added to the form before they were added to the query, and the effect was
   * a box that saved correctly but always redrew EMPTY, so an admin could not
   * see what was set and could blank it by accident.
   */
  advertiser_name: string;
  advertiser_logo_url: string;
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
      .select("id, zone, image_url, click_url, alt_text, advertiser_name, advertiser_logo_url, is_active, sort_order")
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

  /**
   * ONE PUBLISHER LOGO, FOR ONE PICTURE.
   *
   * Same compress-and-upload path the ad pictures use, at a much smaller
   * maxDimension because this is drawn at 32px: a 1600px logo would cost a
   * member bandwidth to render a thumbnail. 256 is generous for a 32px circle
   * even on a 3x screen.
   */
  const [logoBusy, setLogoBusy] = useState<string | null>(null);

  const onLogo = async (rowId: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = (e.target.files || [])[0];
    if (e.target) e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast({ title: "Please choose an image (jpg / png / webp)", variant: "destructive" });
      return;
    }
    setLogoBusy(rowId);
    try {
      const { webpFile } = await compressImageToFiles(file, `ad-logo-${zone}`, { maxDimension: 256 });
      const path = generateImagePath({ type: "ad", ext: "webp" });
      const { url } = await uploadImage({
        bucket: "journal-images", file: webpFile, path, type: "ad", fileName: `ad-logo-${zone}.webp`,
      });
      await patch(rowId, { advertiser_logo_url: url });
      toast({ title: "Publisher logo added ✅" });
    } catch {
      toast({ title: "Could not upload that logo", variant: "destructive" });
    } finally {
      setLogoBusy(null);
    }
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
                {/* THE AD'S OWN PAGE, READY TO COPY.

                    Owner, 2026-08-11: "For each Advertisement, each Ad page
                    link how can i get URL during posting time admin panel ??"

                    Every creative in this library has a page of its own at
                    /ad/<id> — the one a member reaches from the Share button on
                    the feed card, and the one a reply notification opens. This
                    is that link, spelled out under the picture it belongs to,
                    with one tap to copy and one to open it.

                    It appears the moment the picture is uploaded, because the
                    row (and therefore the id) is created by the upload itself —
                    there is no draft state to wait through.

                    Built from adPath(), the same single definition the feed
                    card and the page use, so these three can never disagree
                    about what an ad's URL is. Do not hand-write "/ad/" here. */}
                <div className="flex items-center gap-1.5">
                  <input
                    readOnly
                    className={`${input} text-muted-foreground cursor-text`}
                    style={bFont}
                    value={publicUrl(adPath(r.id))}
                    onFocus={(e) => e.currentTarget.select()}
                    aria-label="This ad's page link"
                  />
                  <button
                    type="button"
                    title="Copy this ad's page link"
                    aria-label="Copy this ad's page link"
                    onClick={async () => {
                      const url = publicUrl(adPath(r.id));
                      try {
                        await navigator.clipboard.writeText(url);
                        toast({ title: "Ad link copied", description: url });
                      } catch {
                        // Refused in some embedded webviews. The field beside
                        // this button holds the URL and selects on focus, so
                        // say what happened rather than claiming success.
                        toast({ title: "Could not copy — select the link and copy it", description: url });
                      }
                    }}
                    className="shrink-0 text-muted-foreground hover:text-primary"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                  <a
                    href={adPath(r.id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Open this ad's page"
                    aria-label="Open this ad's page"
                    className="shrink-0 text-muted-foreground hover:text-primary"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>
                {/* WHO IS ADVERTISING.
                    Leave it empty and the feed card is headed by the site logo,
                    "50mm Retina World" and its blue verified tick — right while
                    the ad is our own. Type a company in and the card is headed
                    by THEIR name with a plain letter avatar and NO tick, because
                    a tick means "this account is verified" and we have verified
                    nothing about them. */}
                <input
                  className={input}
                  style={bFont}
                  defaultValue={r.advertiser_name || ""}
                  placeholder="Publisher name — leave empty if this ad is ours"
                  onBlur={(e) => { if (e.target.value !== (r.advertiser_name || "")) void patch(r.id, { advertiser_name: e.target.value.trim() }); }}
                />
                {/* THE PUBLISHER'S LOGO, shown as the round avatar on the feed
                    card exactly where Instagram puts the advertiser's picture.
                    Round here too, at the size it will actually be drawn, so
                    what the admin sees is what a member sees. */}
                <div className="flex items-center gap-2">
                  {r.advertiser_logo_url ? (
                    <img src={r.advertiser_logo_url} alt="" className="h-8 w-8 rounded-full object-cover border border-border shrink-0" />
                  ) : (
                    <span className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0 text-[11px] text-primary" style={hFont}>
                      {(r.advertiser_name || "").trim()[0]?.toUpperCase() || "—"}
                    </span>
                  )}
                  <label className="text-[10px] text-primary hover:underline cursor-pointer" style={bFont}>
                    {logoBusy === r.id ? "Uploading…" : r.advertiser_logo_url ? "Change logo" : "Add publisher logo"}
                    <input type="file" accept="image/*" className="hidden" disabled={logoBusy === r.id}
                      onChange={(e) => void onLogo(r.id, e)} />
                  </label>
                  {r.advertiser_logo_url && (
                    <button type="button" onClick={() => void patch(r.id, { advertiser_logo_url: "" })}
                      className="text-[10px] text-muted-foreground hover:text-destructive" style={bFont}>
                      Remove
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default AdCreativeLibrary;
