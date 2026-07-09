import { useState } from "react";
import { Eye, XCircle, X, Search, RotateCcw, Loader2, Ban } from "lucide-react";
import PhaseWatermark from "@/components/competition/PhaseWatermark";
import { isPhotoRejected } from "@/lib/photoRejection";

interface EntryRow {
  id: string;
  title: string;
  status: string;
  photos: string[];
  photo_thumbnails?: string[] | null;
  photo_meta: any[] | null;
  created_at: string;
  user_id: string;
  competition_id: string;
  profiles: { full_name: string | null } | null;
  competition_title?: string;
  /** Step 20: canonical phase of the parent competition (for watermark). */
  competition_phase?: string;
  /** Step 20: active judging round ("1"|"2"|"3"|"4"|null). */
  competition_current_round?: string | null;
}

interface Props {
  entries: EntryRow[];
  /** Per-photo reject/restore. Calls admin_set_photo_rejected RPC. */
  onTogglePhotoRejected: (entryId: string, photoIndex: number, rejected: boolean, reason?: string) => void;
  /** "{entryId}::{photoIndex}" while a toggle is in flight. */
  pendingKey: string | null;
}

const photoKey = (entryId: string, photoIndex: number) => `${entryId}::${photoIndex}`;

const AdminEntriesSection = ({ entries, onTogglePhotoRejected, pendingKey }: Props) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [previewEntry, setPreviewEntry] = useState<EntryRow | null>(null);
  const [previewIndex, setPreviewIndex] = useState(0);

  const filtered = entries.filter((e) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      e.title.toLowerCase().includes(q) ||
      (e.profiles?.full_name || "").toLowerCase().includes(q) ||
      (e.competition_title || "").toLowerCase().includes(q)
    );
  });

  const openPreview = (entry: EntryRow, idx = 0) => {
    setPreviewEntry(entry);
    setPreviewIndex(idx);
  };

  const closePreview = () => {
    setPreviewEntry(null);
    setPreviewIndex(0);
  };

  /** Per-photo thumbnail with reject/restore overlay. */
  const PhotoThumb = ({
    entry,
    idx,
    size = "md",
  }: {
    entry: EntryRow;
    idx: number;
    size?: "sm" | "md";
  }) => {
    // Grid uses lightweight thumbnail; falls back to full-res when no thumb generated.
    const thumb = entry.photo_thumbnails?.[idx];
    const url = (thumb && thumb.length > 0) ? thumb : entry.photos[idx];
    const rejected = isPhotoRejected(entry.photo_meta, idx);
    const isPending = pendingKey === photoKey(entry.id, idx);
    const dim = size === "sm" ? "w-9 h-9" : "w-10 h-10";

    return (
      <div className={`relative group/thumb ${dim} shrink-0`}>
        <button
          type="button"
          onClick={() => openPreview(entry, idx)}
          className={`block ${dim} overflow-hidden border ${
            rejected ? "border-destructive/60 grayscale opacity-50" : "border-border hover:border-primary/50"
          } transition-all`}
          title={rejected ? "Rejected — click to view" : "View full"}
        >
          <img loading="lazy" decoding="async" src={url} alt="" className="w-full h-full object-cover" />
          {rejected && (
            <div className="absolute inset-0 flex items-center justify-center bg-destructive/20">
              <Ban className="h-3.5 w-3.5 text-destructive" />
            </div>
          )}
        </button>
        {/* Hover action: reject / restore single photo */}
        <button
          type="button"
          disabled={isPending}
          onClick={(e) => {
            e.stopPropagation();
            const next = !rejected;
            const reason = next ? window.prompt("Reason for rejecting this photo?") : undefined;
            if (next && reason === null) return; // cancelled
            onTogglePhotoRejected(entry.id, idx, next, reason || undefined);
          }}
          className={`absolute -top-1 -right-1 h-4 w-4 rounded-full flex items-center justify-center text-[10px] shadow-md border border-background transition-opacity ${
            rejected
              ? "bg-foreground text-background opacity-100"
              : "bg-destructive text-destructive-foreground opacity-0 group-hover/thumb:opacity-100"
          } disabled:opacity-50`}
          title={rejected ? "Restore this photo" : "Reject this photo"}
        >
          {isPending ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : rejected ? <RotateCcw className="h-2.5 w-2.5" /> : <XCircle className="h-2.5 w-2.5" />}
        </button>
      </div>
    );
  };

  return (
    <div>
      <div className="flex items-center gap-3 mb-1">
        <div className="w-8 h-px bg-primary" />
        <span className="text-[10px] tracking-[0.3em] uppercase text-primary" style={{ fontFamily: "var(--font-heading)" }}>Moderation</span>
      </div>
      <span className="text-[9px] tracking-[0.3em] uppercase text-muted-foreground block mb-1" style={{ fontFamily: "var(--font-heading)" }}>
        {filtered.length} of {entries.length} entr{entries.length !== 1 ? "ies" : "y"}
      </span>
      <p className="text-[10px] text-muted-foreground mb-4" style={{ fontFamily: "var(--font-body)" }}>
        Hover a photo to reject it individually. Entry is auto-marked rejected only when <em>all</em> photos are rejected.
      </p>

      {/* Search Bar */}
      <div className="relative mb-6 max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search by entry title, photographer, or competition..."
          className="w-full bg-transparent border border-border focus:border-primary outline-none pl-9 pr-8 py-2.5 text-sm transition-colors duration-300"
          style={{ fontFamily: "var(--font-body)" }}
        />
        {searchQuery && (
          <button onClick={() => setSearchQuery("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Desktop Table */}
      <div className="hidden md:block border border-border overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-border">
              {["Entry", "Competition", "Photographer", "Photos (hover to reject)", "Status"].map((h) => (
                <th key={h} className="px-4 py-3 text-[9px] tracking-[0.2em] uppercase text-muted-foreground font-normal" style={{ fontFamily: "var(--font-heading)" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.map((entry) => {
              const total = entry.photos.length;
              const rejectedCount = entry.photos.reduce(
                (n, _, i) => (isPhotoRejected(entry.photo_meta, i) ? n + 1 : n),
                0,
              );
              return (
                <tr key={entry.id} className="hover:bg-muted/30 transition-colors duration-300 align-top">
                  <td className="px-4 py-3 text-sm" style={{ fontFamily: "var(--font-body)" }}>{entry.title}</td>
                  <td className="px-4 py-3 text-[10px] text-muted-foreground">{entry.competition_title}</td>
                  <td className="px-4 py-3 text-[11px] text-muted-foreground">{entry.profiles?.full_name || "Unknown"}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1.5 max-w-[260px]">
                      {entry.photos.map((_, i) => (
                        <PhotoThumb key={i} entry={entry} idx={i} />
                      ))}
                    </div>
                    {rejectedCount > 0 && (
                      <p className="text-[9px] text-destructive mt-1.5" style={{ fontFamily: "var(--font-heading)" }}>
                        {rejectedCount}/{total} rejected
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-[9px] tracking-[0.2em] uppercase px-2.5 py-1 border ${entry.status === "rejected" ? "text-destructive border-destructive" : "text-muted-foreground border-border"}`} style={{ fontFamily: "var(--font-heading)" }}>
                      {entry.status}
                    </span>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-sm text-muted-foreground">{searchQuery ? "No entries match your search" : "No entries yet"}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile Cards */}
      <div className="md:hidden space-y-2">
        {filtered.map((entry) => {
          const total = entry.photos.length;
          const rejectedCount = entry.photos.reduce(
            (n, _, i) => (isPhotoRejected(entry.photo_meta, i) ? n + 1 : n),
            0,
          );
          return (
            <div key={entry.id} className="border border-border rounded-sm p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate" style={{ fontFamily: "var(--font-body)" }}>{entry.title}</p>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{entry.competition_title}</p>
                  <p className="text-[10px] text-muted-foreground">{entry.profiles?.full_name || "Unknown"}</p>
                </div>
                <span className={`text-[9px] tracking-[0.15em] uppercase px-2 py-0.5 border shrink-0 ${entry.status === "rejected" ? "text-destructive border-destructive" : "text-muted-foreground border-border"}`} style={{ fontFamily: "var(--font-heading)" }}>
                  {entry.status}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {entry.photos.map((_, i) => (
                  <PhotoThumb key={i} entry={entry} idx={i} size="sm" />
                ))}
              </div>
              {rejectedCount > 0 && (
                <p className="text-[9px] text-destructive" style={{ fontFamily: "var(--font-heading)" }}>
                  {rejectedCount}/{total} rejected
                </p>
              )}
            </div>
          );
        })}
        {filtered.length === 0 && (
          <div className="text-center py-10 border border-dashed border-border rounded-sm">
            <p className="text-sm text-muted-foreground">{searchQuery ? "No entries match your search" : "No entries yet"}</p>
          </div>
        )}
      </div>

      {/* Full Image Preview Lightbox */}
      {previewEntry && (
        <div className="fixed inset-0 z-50 bg-black/90 flex flex-col items-center justify-center" onClick={closePreview}>
          <div className="absolute top-4 left-4 right-4 flex items-center justify-between z-10">
            <div className="flex items-center gap-3">
              <span className="text-[10px] tracking-[0.2em] uppercase text-white/60" style={{ fontFamily: "var(--font-heading)" }}>
                {previewIndex + 1} / {previewEntry.photos.length}
              </span>
              <span className="text-xs text-white/80 truncate max-w-[200px] md:max-w-md" style={{ fontFamily: "var(--font-body)" }}>
                {previewEntry.title}
              </span>
              {isPhotoRejected(previewEntry.photo_meta, previewIndex) && (
                <span className="text-[9px] tracking-[0.2em] uppercase text-destructive border border-destructive px-2 py-0.5">Rejected</span>
              )}
            </div>
            <button onClick={closePreview} className="p-2 text-white/70 hover:text-white transition-colors">
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="relative max-w-[90vw] max-h-[80vh] flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
            <img loading="lazy" decoding="async"
              src={previewEntry.photos[previewIndex]}
              alt={`${previewEntry.title} - Photo ${previewIndex + 1}`}
              className="max-w-full max-h-[80vh] object-contain"
            />
            {previewEntry.competition_phase && (
              <PhaseWatermark
                phase={previewEntry.competition_phase}
                currentRound={previewEntry.competition_current_round ?? null}
                surface="lightbox"
              />
            )}
            {previewEntry.photos.length > 1 && previewIndex > 0 && (
              <button onClick={() => setPreviewIndex((i) => i - 1)} className="absolute left-2 top-1/2 -translate-y-1/2 p-2 bg-black/50 text-white/80 hover:text-white hover:bg-black/70 transition-colors rounded-sm">‹</button>
            )}
            {previewEntry.photos.length > 1 && previewIndex < previewEntry.photos.length - 1 && (
              <button onClick={() => setPreviewIndex((i) => i + 1)} className="absolute right-2 top-1/2 -translate-y-1/2 p-2 bg-black/50 text-white/80 hover:text-white hover:bg-black/70 transition-colors rounded-sm">›</button>
            )}
          </div>

          {previewEntry.photos.length > 1 && (
            <div className="flex gap-2 mt-4 overflow-x-auto max-w-[90vw] pb-2" onClick={(e) => e.stopPropagation()}>
              {previewEntry.photos.map((p, i) => {
                const rj = isPhotoRejected(previewEntry.photo_meta, i);
                const tThumb = previewEntry.photo_thumbnails?.[i];
                const tUrl = (tThumb && tThumb.length > 0) ? tThumb : p;
                return (
                  <img loading="lazy" decoding="async" key={i} src={tUrl} alt="" onClick={() => setPreviewIndex(i)}
                    className={`w-12 h-12 object-cover cursor-pointer border-2 transition-colors shrink-0 ${i === previewIndex ? "border-primary" : "border-white/20 hover:border-white/50"} ${rj ? "grayscale opacity-50" : ""}`} />
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default AdminEntriesSection;
