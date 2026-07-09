import { useState, useEffect, useMemo } from "react";
import { Vote, Loader2, Undo2, Plus, Search, Eye } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cachedFetchProfilesByIds } from "@/lib/profileBatch";
import { toast } from "@/hooks/core/use-toast";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

interface Props {
  competitionId: string;
  adminId: string;
}

/**
 * Per-photo vote audit row.
 * Enforces 'One Image, One Vote' — one row per (entry_id, photo_index).
 */
interface PhotoVoteRow {
  entryId: string;
  photoIndex: number;
  totalPhotos: number;
  entryTitle: string;
  photographerName: string;
  submissionDate: string;
  /** Full-res — used by preview lightbox. */
  photoUrl: string | null;
  /** Lightweight thumbnail — used by grid cell. Falls back to photoUrl. */
  thumbUrl: string | null;
  realVotes: number;
  adjustmentTotal: number;
  finalVotes: number;
}

interface AdjustmentRow {
  id: string;
  entry_id: string;
  photo_index: number;
  admin_id: string;
  admin_name: string;
  adjustment_value: number;
  reason: string | null;
  created_at: string;
}

const photoKey = (entryId: string, photoIndex: number) => `${entryId}::${photoIndex}`;

const AdminVoteAuditPanel = ({ competitionId, adminId }: Props) => {
  const [rows, setRows] = useState<PhotoVoteRow[]>([]);
  const [adjustments, setAdjustments] = useState<AdjustmentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [reverting, setReverting] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  // Add vote state
  const [addVoteEntry, setAddVoteEntry] = useState<PhotoVoteRow | null>(null);
  const [addVoteValue, setAddVoteValue] = useState("1");
  const [addVoteReason, setAddVoteReason] = useState("");
  const [addingVote, setAddingVote] = useState(false);

  const fetchData = async () => {
    setLoading(true);

    const { data: entries } = await supabase
      .from("competition_entries")
      .select("id, title, photos, photo_thumbnails, photo_meta, user_id, created_at")
      .eq("competition_id", competitionId)
      .order("created_at", { ascending: false });

    if (!entries || entries.length === 0) {
      setRows([]);
      setAdjustments([]);
      setLoading(false);
      return;
    }

    const entryIds = entries.map((e) => e.id);
    const userIds = [...new Set(entries.map((e) => e.user_id))];

    const [profileMap, votesRes, adjsRes] = await Promise.all([
      cachedFetchProfilesByIds(userIds),
      supabase.from("competition_votes").select("entry_id, photo_index").in("entry_id", entryIds),
      supabase
        .from("admin_vote_adjustments")
        .select("id, entry_id, photo_index, admin_id, adjustment_value, reason, created_at")
        .eq("competition_id", competitionId)
        .order("created_at", { ascending: false }),
    ]);

    const votes = votesRes.data || [];
    const adjs = adjsRes.data || [];

    const adminIds = [...new Set(adjs.map((a) => a.admin_id))];
    const adminProfileMap = adminIds.length > 0 ? await cachedFetchProfilesByIds(adminIds) : new Map();

    // Per-photo aggregation
    const voteCounts = new Map<string, number>();
    votes.forEach((v: any) => {
      const k = photoKey(v.entry_id, v.photo_index ?? 0);
      voteCounts.set(k, (voteCounts.get(k) || 0) + 1);
    });

    const adjTotals = new Map<string, number>();
    adjs.forEach((a: any) => {
      const k = photoKey(a.entry_id, a.photo_index ?? 0);
      adjTotals.set(k, (adjTotals.get(k) || 0) + a.adjustment_value);
    });

    // Expand each entry into one row per photo
    const result: PhotoVoteRow[] = entries.flatMap((e: any) => {
      const photos: string[] = e.photos || [];
      const thumbs: string[] = Array.isArray(e.photo_thumbnails) ? e.photo_thumbnails : [];
      const meta: any[] = Array.isArray(e.photo_meta) ? e.photo_meta : [];
      const total = Math.max(1, photos.length);
      return Array.from({ length: total })
        .map((_, idx) => {
          // Per-photo "One Image, One Reject" — hide rejected photos from audit grid.
          if (meta[idx]?.rejected === true) return null;
          const k = photoKey(e.id, idx);
          const real = voteCounts.get(k) || 0;
          const adj = adjTotals.get(k) || 0;
          const fullUrl = photos[idx] || null;
          const t = thumbs[idx];
          return {
            entryId: e.id,
            photoIndex: idx,
            totalPhotos: total,
            entryTitle: e.title,
            photographerName: profileMap.get(e.user_id) || "Unknown",
            submissionDate: e.created_at,
            photoUrl: fullUrl,
            thumbUrl: (typeof t === "string" && t.length > 0) ? t : fullUrl,
            realVotes: real,
            adjustmentTotal: adj,
            finalVotes: real + adj,
          } satisfies PhotoVoteRow;
        })
        .filter((r): r is PhotoVoteRow => r !== null);
    });
    result.sort((a, b) => b.finalVotes - a.finalVotes);

    setRows(result);
    setAdjustments(
      adjs.map((a: any) => ({
        ...a,
        photo_index: a.photo_index ?? 0,
        admin_name: adminProfileMap.get(a.admin_id) || "Admin",
      }))
    );
    setLoading(false);
  };

  useEffect(() => { fetchData(); }, [competitionId]);

  const filteredRows = useMemo(() => {
    if (!searchQuery.trim()) return rows;
    const q = searchQuery.toLowerCase();
    return rows.filter(
      (r) =>
        r.entryTitle.toLowerCase().includes(q) ||
        r.photographerName.toLowerCase().includes(q)
    );
  }, [rows, searchQuery]);

  const revertAdjustment = async (adj: AdjustmentRow) => {
    setReverting(adj.id);
    const { error } = await supabase.from("admin_vote_adjustments").insert({
      entry_id: adj.entry_id,
      photo_index: adj.photo_index,
      competition_id: competitionId,
      admin_id: adminId,
      adjustment_value: -adj.adjustment_value,
      reason: `Revert: ${adj.reason || "no reason"}`,
    });
    setReverting(null);
    if (error) {
      toast({ title: "Revert failed", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Adjustment reverted" });
      fetchData();
    }
  };

  const handleAddVote = async () => {
    if (!addVoteEntry) return;
    const val = parseInt(addVoteValue, 10);
    if (isNaN(val) || val === 0) {
      toast({ title: "Invalid value", description: "Enter a non-zero number.", variant: "destructive" });
      return;
    }
    if (!addVoteReason.trim()) {
      toast({ title: "Reason required", description: "Provide a reason for audit trail.", variant: "destructive" });
      return;
    }
    setAddingVote(true);
    const { error } = await supabase.from("admin_vote_adjustments").insert({
      entry_id: addVoteEntry.entryId,
      photo_index: addVoteEntry.photoIndex,
      competition_id: competitionId,
      admin_id: adminId,
      adjustment_value: val,
      reason: addVoteReason.trim(),
    });
    setAddingVote(false);
    if (error) {
      toast({ title: "Failed to add votes", description: error.message, variant: "destructive" });
    } else {
      toast({
        title: "Votes adjusted",
        description: `${val > 0 ? "+" : ""}${val} on "${addVoteEntry.entryTitle}" — Photo ${addVoteEntry.photoIndex + 1}`,
      });
      setAddVoteEntry(null);
      setAddVoteValue("1");
      setAddVoteReason("");
      fetchData();
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4 text-muted-foreground text-xs">
        <Loader2 className="h-3 w-3 animate-spin" /> Loading vote data…
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="text-center py-6 border border-dashed border-border rounded-sm">
        <Vote className="h-6 w-6 text-muted-foreground/30 mx-auto mb-2" />
        <p className="text-xs text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>No entries found.</p>
      </div>
    );
  }

  return (
    <div className="border border-border overflow-hidden">
      {/* Header + Search */}
      <div className="px-4 py-3 bg-muted/20 border-b border-border flex items-center gap-3 flex-wrap">
        <Vote className="h-3.5 w-3.5 text-primary shrink-0" />
        <span className="text-[9px] tracking-[0.15em] uppercase text-muted-foreground font-semibold shrink-0" style={{ fontFamily: "var(--font-heading)" }}>
          Vote Audit ({rows.length} photos · One Image · One Vote)
        </span>
        <div className="relative ml-auto w-full max-w-[260px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
          <Input
            placeholder="Search by name or title…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="h-7 pl-7 text-xs"
          />
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left min-w-[760px]">
          <thead>
            <tr className="border-b border-border">
              {["Preview", "Entry · Photo", "Photographer", "Submitted", "Real Votes", "Adj", "Final", "Action"].map((h) => (
                <th key={h} className="px-3 py-2 text-[9px] tracking-[0.15em] uppercase text-muted-foreground font-normal whitespace-nowrap" style={{ fontFamily: "var(--font-heading)" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filteredRows.map((r) => {
              const k = photoKey(r.entryId, r.photoIndex);
              const photoAdjs = adjustments.filter(
                (a) => a.entry_id === r.entryId && (a.photo_index ?? 0) === r.photoIndex
              );
              const isExpanded = expandedKey === k;
              return (
                <tr key={k} className="group hover:bg-muted/30 transition-colors">
                  {/* Image Preview */}
                  <td className="px-3 py-2">
                    {r.photoUrl ? (
                      <button onClick={() => setPreviewImage(r.photoUrl)} className="block rounded overflow-hidden border border-border hover:border-primary transition-colors" title="View full image">
                        <img src={r.thumbUrl ?? r.photoUrl} alt={`${r.entryTitle} – photo ${r.photoIndex + 1}`} className="h-10 w-10 object-cover" loading="lazy" decoding="async" />
                      </button>
                    ) : (
                      <div className="h-10 w-10 bg-muted rounded flex items-center justify-center">
                        <Eye className="h-3 w-3 text-muted-foreground/40" />
                      </div>
                    )}
                  </td>
                  {/* Entry · Photo + Adj history */}
                  <td className="px-3 py-2 max-w-[200px]">
                    <button
                      onClick={() => setExpandedKey(isExpanded ? null : k)}
                      className="text-xs text-foreground hover:text-primary transition-colors text-left truncate block w-full"
                      style={{ fontFamily: "var(--font-body)" }}
                    >
                      {r.entryTitle}
                      <span className="text-[10px] text-primary/80 ml-1">· Photo {r.photoIndex + 1}/{r.totalPhotos}</span>
                      {photoAdjs.length > 0 && <span className="text-[9px] text-muted-foreground ml-1">({photoAdjs.length} adj)</span>}
                    </button>
                    {isExpanded && photoAdjs.length > 0 && (
                      <div className="mt-2 space-y-1 border-t border-border/50 pt-2">
                        {photoAdjs.map((a) => (
                          <div key={a.id} className="flex items-center gap-2 text-[10px] text-muted-foreground">
                            <span className={a.adjustment_value > 0 ? "text-primary font-bold" : "text-destructive font-bold"}>
                              {a.adjustment_value > 0 ? "+" : ""}{a.adjustment_value}
                            </span>
                            <span className="truncate flex-1">{a.reason || "—"}</span>
                            <span className="shrink-0">{a.admin_name}</span>
                            <span className="shrink-0 text-muted-foreground/50">{new Date(a.created_at).toLocaleDateString()}</span>
                            <button
                              onClick={() => revertAdjustment(a)}
                              disabled={reverting === a.id}
                              className="shrink-0 p-0.5 text-destructive hover:text-destructive/70 transition-colors disabled:opacity-50"
                              title="Revert this adjustment"
                            >
                              <Undo2 className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </td>
                  {/* Photographer */}
                  <td className="px-3 py-2 text-xs text-foreground whitespace-nowrap" style={{ fontFamily: "var(--font-body)" }}>
                    {r.photographerName}
                  </td>
                  {/* Submission Date */}
                  <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap" style={{ fontFamily: "var(--font-body)" }}>
                    {new Date(r.submissionDate).toLocaleDateString()}
                  </td>
                  {/* Real Votes */}
                  <td className="px-3 py-2 text-xs text-foreground" style={{ fontFamily: "var(--font-heading)" }}>{r.realVotes}</td>
                  {/* Adjustments */}
                  <td className="px-3 py-2 text-xs" style={{ fontFamily: "var(--font-heading)" }}>
                    <span className={r.adjustmentTotal !== 0 ? (r.adjustmentTotal > 0 ? "text-primary" : "text-destructive") : "text-muted-foreground"}>
                      {r.adjustmentTotal > 0 ? "+" : ""}{r.adjustmentTotal}
                    </span>
                  </td>
                  {/* Final */}
                  <td className="px-3 py-2 text-xs font-bold" style={{ fontFamily: "var(--font-heading)" }}>{r.finalVotes}</td>
                  {/* Add Vote Action */}
                  <td className="px-3 py-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 px-2 text-[10px] gap-1"
                      onClick={() => { setAddVoteEntry(r); setAddVoteValue("1"); setAddVoteReason(""); }}
                    >
                      <Plus className="h-3 w-3" /> Add
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {filteredRows.length === 0 && searchQuery && (
        <div className="text-center py-4 text-xs text-muted-foreground">No photos match "{searchQuery}"</div>
      )}

      {/* Image Preview Dialog */}
      <Dialog open={!!previewImage} onOpenChange={() => setPreviewImage(null)}>
        <DialogContent className="max-w-lg p-2">
          {previewImage && <img loading="lazy" decoding="async" src={previewImage} alt="Preview" className="w-full rounded" />}
        </DialogContent>
      </Dialog>

      {/* Add Vote Dialog */}
      <Dialog open={!!addVoteEntry} onOpenChange={(open) => { if (!open) setAddVoteEntry(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-sm">Add Vote Adjustment</DialogTitle>
          </DialogHeader>
          {addVoteEntry && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Entry: <span className="text-foreground font-medium">{addVoteEntry.entryTitle}</span>
                <span className="text-primary ml-1">· Photo {addVoteEntry.photoIndex + 1}/{addVoteEntry.totalPhotos}</span>
              </p>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Vote Value (+ or −)</label>
                <Input
                  type="number"
                  value={addVoteValue}
                  onChange={(e) => setAddVoteValue(e.target.value)}
                  className="h-8 text-sm"
                  placeholder="e.g. 5 or -3"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">Reason (required)</label>
                <Textarea
                  value={addVoteReason}
                  onChange={(e) => setAddVoteReason(e.target.value)}
                  className="text-sm min-h-[60px]"
                  placeholder="Audit reason…"
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setAddVoteEntry(null)}>Cancel</Button>
            <Button size="sm" onClick={handleAddVote} disabled={addingVote}>
              {addingVote ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminVoteAuditPanel;
