/**
 * Competitions Module — extracted from AdminPanel.tsx
 * Handles: competition CRUD, form, judges, rounds display
 */
import { useState, useMemo, useEffect, lazy, Suspense } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Pencil, Trash2, Eye, XCircle, Loader2, ArrowUpDown, ArrowUp, ArrowDown, AlertTriangle, Calendar, Clock, DollarSign, Users, Gavel, Vote, CheckCircle2, Archive, Sparkles } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { supabase } from "@/integrations/supabase/client";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { generateImagePath, uploadImage } from "@/lib/imageUpload";
import { compressImageToFiles } from "@/lib/imageCompression";
import { scanFileWithToast } from "@/lib/fileSecurityScanner";
import { safeAdminExecute, assertSupabaseResult } from "@/lib/safeAdminExecute";
import { toast } from "@/hooks/core/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { useAdminCompetitions } from "@/hooks/admin/useAdminCompetitions";
import { useAllCompetitionJudgeNames } from "@/hooks/competition/useCompetitionJudges";
import { competitionService } from "@/services/admin/competitionService";
import { resolveCompetitionPhase, phaseDisplayLabels } from "@/lib/competitionPhase";
import ImageCropModal from "@/components/admin/ImageCropModal";
import CoverImageUploader from "@/components/admin/CoverImageUploader";
import type { User } from "@supabase/supabase-js";

const AdminCompetitionJudges = lazy(() => import("@/components/admin/AdminCompetitionJudges"));
const AdminCompetitionRounds = lazy(() => import("@/components/admin/AdminCompetitionRounds"));
const JudgingDriftAudit = lazy(() => import("@/components/admin/JudgingDriftAudit"));
const AwardsIntegrityAudit = lazy(() => import("@/components/admin/AwardsIntegrityAudit"));
const RoundPublishPanel = lazy(() => import("@/components/admin/RoundPublishPanel"));

const phaseOptions = [
  { value: "upcoming", label: "Upcoming" },
  { value: "submission_open", label: "Open for Submission" },
  { value: "voting", label: "Voting" },
  { value: "judging", label: "Judging in Progress" },
  { value: "result", label: "Results Published" },
  { value: "archived", label: "Archived" },
];

const phaseColor = (p: string) => {
  switch (p) {
    case "upcoming": return "text-blue-400 border-blue-400/40 bg-blue-400/5";
    case "submission_open": return "text-primary border-primary/40 bg-primary/5";
    case "voting": return "text-emerald-400 border-emerald-400/40 bg-emerald-400/5";
    case "judging": return "text-yellow-400 border-yellow-400/40 bg-yellow-400/5";
    case "result": return "text-foreground/60 border-foreground/20 bg-foreground/5";
    case "archived": return "text-muted-foreground/70 border-muted-foreground/30 bg-muted/20";
    default: return "text-muted-foreground border-border";
  }
};

const phaseIcon = (p: string) => {
  switch (p) {
    case "upcoming": return Clock;
    case "submission_open": return Sparkles;
    case "voting": return Vote;
    case "judging": return Gavel;
    case "result": return CheckCircle2;
    case "archived": return Archive;
    default: return Clock;
  }
};

const phaseLabel = (p: string) => phaseOptions.find(o => o.value === p)?.label || p;

/**
 * A-04 — Phase drift / stale-voting indicator.
 * Compares stored phase against the date-derived phase + flags overdue voting windows.
 * Renders nothing when the row is in sync.
 */
const DriftBadge = ({ comp }: { comp: { phase: string; status: string; starts_at: string; ends_at: string; voting_ends_at: string | null; judging_completed: boolean } }) => {
  const expected = resolveCompetitionPhase(comp);
  const stored = comp.phase;
  const now = Date.now();
  const votingEnd = comp.voting_ends_at ? new Date(comp.voting_ends_at).getTime() : null;
  const subEnd = new Date(comp.ends_at).getTime();

  const phaseMismatch = stored !== expected && stored !== "archived";
  const votingOverdue =
    votingEnd !== null &&
    now > votingEnd &&
    !comp.judging_completed &&
    !["result", "archived"].includes(stored);
  const submissionOverdue =
    now > subEnd &&
    ["upcoming", "submission_open"].includes(stored);

  if (!phaseMismatch && !votingOverdue && !submissionOverdue) return null;

  const daysOverdue = votingOverdue
    ? Math.floor((now - (votingEnd as number)) / 86_400_000)
    : submissionOverdue
      ? Math.floor((now - subEnd) / 86_400_000)
      : null;

  const tooltip = [
    phaseMismatch ? `Stored phase: ${phaseDisplayLabels[stored] ?? stored} · Expected: ${phaseDisplayLabels[expected] ?? expected}` : null,
    votingOverdue ? `Voting ended ${daysOverdue}d ago — phase not advanced` : null,
    submissionOverdue ? `Submission closed ${daysOverdue}d ago — phase not advanced` : null,
  ].filter(Boolean).join(" · ");

  const label = votingOverdue
    ? `Voting +${daysOverdue}d`
    : submissionOverdue
      ? `Subs +${daysOverdue}d`
      : "Drift";

  return (
    <span
      title={tooltip}
      className="inline-flex items-center gap-1 text-[8px] tracking-[0.15em] uppercase px-1.5 py-0.5 border border-amber-500 text-amber-500 bg-amber-500/5 rounded-sm"
      style={{ fontFamily: "var(--font-heading)" }}
    >
      <AlertTriangle className="h-2.5 w-2.5" />
      {label}
    </span>
  );
};

/**
 * Live remaining-time indicator (UTC-anchored).
 * Shows a bright light-green countdown for the active phase target.
 */
const RemainingTime = ({ comp, compact = false }: { comp: { phase: string; ends_at: string; voting_ends_at: string | null }; compact?: boolean }) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const phase = comp.phase;
  if (!["submission_open", "voting", "judging"].includes(phase)) return null;

  const target =
    phase === "submission_open"
      ? new Date(comp.ends_at).getTime()
      : new Date(comp.voting_ends_at || comp.ends_at).getTime();

  const diff = target - now;
  const abs = Math.abs(diff);
  const days = Math.floor(abs / 86_400_000);
  const hours = Math.floor((abs % 86_400_000) / 3_600_000);
  const minutes = Math.floor((abs % 3_600_000) / 60_000);
  const seconds = Math.floor((abs % 60_000) / 1000);

  const parts = days > 0
    ? `${days}d ${hours}h ${String(minutes).padStart(2, "0")}m`
    : hours > 0
      ? `${hours}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`
      : `${minutes}m ${String(seconds).padStart(2, "0")}s`;

  const verb =
    phase === "submission_open" ? (diff > 0 ? "Closes in" : "Closed")
    : phase === "voting" ? (diff > 0 ? "Voting in" : "Voting ended")
    : "Judging";

  const colorClass = diff > 0 ? "text-emerald-400" : "text-amber-400";

  const fullTooltip =
    phase === "judging" && diff <= 0
      ? `${parts} since voting closed · UTC: ${new Date(target).toISOString()}`
      : `${verb} ${parts}${diff <= 0 ? " ago" : ""} · UTC: ${new Date(target).toISOString()}`;

  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={`inline-flex items-center gap-1 ${compact ? "text-[9px]" : "text-[10px]"} tabular-nums tracking-wider ${colorClass} cursor-help whitespace-nowrap`}
            style={{ fontFamily: "var(--font-heading)" }}
          >
            <Clock className="h-2.5 w-2.5 shrink-0" />
            {parts}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="text-xs">{fullTooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};

const FormField = ({ label, value, onChange, placeholder, type = "text" }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string;
}) => (
  <div>
    <label className="block text-[10px] tracking-[0.2em] uppercase text-muted-foreground mb-2" style={{ fontFamily: "var(--font-heading)" }}>{label}</label>
    <input type={type} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
      className="w-full bg-transparent border-b border-border focus:border-primary outline-none py-3 text-sm transition-colors duration-500"
      style={{ fontFamily: "var(--font-body)" }} />
  </div>
);

interface Props {
  user: User | null;
}

const CompetitionsModule = ({ user }: Props) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { competitions } = useAdminCompetitions();
  const compIds = competitions.map((c) => c.id);
  const { data: judgeNamesMap = new Map<string, string[]>() } = useAllCompetitionJudgeNames(compIds);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: "", description: "", category: "General", cover_image_url: "",
    entry_fee: "0", prize_info: "", max_entries_per_user: "1", max_photos_per_entry: "5",
    starts_at: "", ends_at: "", voting_ends_at: "",
    paypal_email: "", bank_details: "", upi_id: "", ai_images_allowed: true,
  });
  const [saving, setSaving] = useState(false);
  const [coverCropSrc, setCoverCropSrc] = useState<string | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<string | null>(null);
  const [hardDeleteTarget, setHardDeleteTarget] = useState<string | null>(null);
  const [hardDeleting, setHardDeleting] = useState(false);
  const [sortCol, setSortCol] = useState<"title" | "category" | "phase" | "starts_at" | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const toggleSort = (col: typeof sortCol) => {
    if (sortCol === col) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortCol(col);
      setSortDir("asc");
    }
  };

  const sortedCompetitions = useMemo(() => {
    if (!sortCol) return competitions;
    return [...competitions].sort((a, b) => {
      let av: string, bv: string;
      switch (sortCol) {
        case "title": av = a.title.toLowerCase(); bv = b.title.toLowerCase(); break;
        case "category": av = a.category.toLowerCase(); bv = b.category.toLowerCase(); break;
        case "phase": av = a.phase; bv = b.phase; break;
        case "starts_at": av = a.starts_at; bv = b.starts_at; break;
        default: return 0;
      }
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [competitions, sortCol, sortDir]);

  const resetForm = () => {
    setForm({
      title: "", description: "", category: "General", cover_image_url: "",
      entry_fee: "0", prize_info: "", max_entries_per_user: "1", max_photos_per_entry: "5",
      starts_at: "", ends_at: "", voting_ends_at: "",
      paypal_email: "", bank_details: "", upi_id: "", ai_images_allowed: true,
    });
    setEditingId(null);
    setShowForm(false);
  };

  const handleCoverCropComplete = async (croppedFile: File) => {
    setCoverCropSrc(null);
    try {
      const safe = await scanFileWithToast(croppedFile, toast, { allowedTypes: "image" });
      if (!safe) return;
      const baseName = `comp-cover-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const { webpFile } = await compressImageToFiles(croppedFile, baseName);
      const path = generateImagePath({ type: "comp-cover", ext: "webp" });
      const result = await uploadImage({ bucket: "competition-photos", file: webpFile, path, type: "comp-cover", fileName: `${baseName}.webp` });
      setForm(prev => ({ ...prev, cover_image_url: result.url }));
      toast({ title: "Cover image uploaded" });
    } catch (err: unknown) {
      toast({ title: "Upload failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    }
  };

  const openEdit = async (comp: { id: string }) => {
    setEditingId(comp.id);
    try {
      const data = await competitionService.fetchFullCompetition(comp.id);
      if (!data) {
        toast({ title: "Competition not found", variant: "destructive" });
        return;
      }
      const pd = await competitionService.fetchPaymentDetails(comp.id);
      setForm({
        title: data.title || "", description: data.description || "",
        category: data.category || "General", cover_image_url: data.cover_image_url || "",
        entry_fee: String(Math.min(parseFloat(String(data.entry_fee || 0)), 10000)),
        prize_info: data.prize_info || "",
        max_entries_per_user: String(Math.max(1, Math.min(parseInt(String(data.max_entries_per_user || 1)), 50))),
        max_photos_per_entry: String(Math.max(1, Math.min(parseInt(String(data.max_photos_per_entry || 5)), 20))),
        starts_at: data.starts_at ? data.starts_at.slice(0, 16) : "",
        ends_at: data.ends_at ? data.ends_at.slice(0, 16) : "",
        voting_ends_at: data.voting_ends_at ? data.voting_ends_at.slice(0, 16) : "",
        paypal_email: pd?.paypal_email || "", bank_details: pd?.bank_details || "",
        upi_id: pd?.upi_id || "",
        ai_images_allowed: (data as any).ai_images_allowed !== false,
      });
      setShowForm(true);
    } catch (err: unknown) {
      toast({ title: "Failed to load competition", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    }
  };

  const handleSave = async () => {
    if (!user || !form.title.trim() || !form.starts_at || !form.ends_at) {
      toast({ title: "Please fill in required fields (title, dates)", variant: "destructive" });
      return;
    }
    if (form.title.trim().length > 200) { toast({ title: "Title must be under 200 characters", variant: "destructive" }); return; }
    const entryFee = parseFloat(form.entry_fee) || 0;
    if (entryFee < 0 || entryFee > 10000) { toast({ title: "Entry fee must be $0–$10,000", variant: "destructive" }); return; }
    const maxEntries = parseInt(form.max_entries_per_user) || 1;
    if (maxEntries < 1 || maxEntries > 50) { toast({ title: "Max entries per user: 1–50", variant: "destructive" }); return; }
    const maxPhotos = parseInt(form.max_photos_per_entry) || 5;
    if (maxPhotos < 1 || maxPhotos > 20) { toast({ title: "Max photos per entry: 1–20", variant: "destructive" }); return; }

    const startDate = new Date(form.starts_at);
    const endDate = new Date(form.ends_at);
    const votingEndDate = form.voting_ends_at ? new Date(form.voting_ends_at) : null;
    if (startDate >= endDate) { toast({ title: "Start date must be before end date", variant: "destructive" }); return; }
    if (votingEndDate && votingEndDate <= endDate) { toast({ title: "Voting end must be after submission end", variant: "destructive" }); return; }

    setSaving(true);
    try {
      const payload = {
        title: form.title.trim(), description: form.description.trim() || null,
        category: form.category, cover_image_url: form.cover_image_url.trim() || null,
        entry_fee: entryFee, prize_info: form.prize_info.trim() || null,
        max_entries_per_user: maxEntries,
        max_photos_per_entry: maxPhotos,
        starts_at: startDate.toISOString(), ends_at: endDate.toISOString(),
        voting_ends_at: votingEndDate ? votingEndDate.toISOString() : endDate.toISOString(),
        ai_images_allowed: form.ai_images_allowed,
      };

      let error;
      let compId = editingId;
      if (editingId) {
        ({ error } = await competitionService.updateCompetition(editingId, payload));
      } else {
        const res = await competitionService.createCompetition({ ...payload, created_by: user.id });
        error = res.error;
        compId = res.data?.id || null;
        if (!error && compId) await competitionService.createDefaultRounds(compId);
      }

      if (!error && compId && (form.paypal_email.trim() || form.bank_details.trim() || form.upi_id.trim())) {
        await competitionService.upsertPaymentDetails(compId, {
          paypal_email: form.paypal_email.trim() || null,
          bank_details: form.bank_details.trim() || null,
          upi_id: form.upi_id.trim() || null,
        });
      }

      if (error) {
        toast({ title: "Failed to save", description: error.message, variant: "destructive" });
      } else {
        const wasNew = !editingId;
        toast({ title: wasNew ? "Competition created — you can now add judges & rounds" : "Competition updated" });
        queryClient.invalidateQueries({ queryKey: queryKeys.adminCompetitions() });
        if (wasNew && compId) setEditingId(compId);
        else resetForm();
      }
    } catch (err: unknown) {
      toast({ title: "Save failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const confirmArchive = async () => {
    if (!archiveTarget) return;
    await safeAdminExecute("Archive competition", async () => {
      const result = await competitionService.archiveCompetition(archiveTarget, user?.id || "");
      assertSupabaseResult(result, "Archive competition");
      queryClient.invalidateQueries({ queryKey: queryKeys.adminCompetitions() });
      queryClient.invalidateQueries({ queryKey: queryKeys.adminEntries() });
    }, { successMessage: "Competition archived" });
    setArchiveTarget(null);
  };

  const confirmHardDelete = async () => {
    if (!hardDeleteTarget) return;
    setHardDeleting(true);
    await safeAdminExecute("Permanently delete competition", async () => {
      const { data, error } = await supabase.functions.invoke("hard-delete-competition", {
        body: { competition_id: hardDeleteTarget },
      });
      // Treat "Competition not found" (404 from edge fn) as already-deleted success:
      // a prior call succeeded server-side but the UI saw a transient residue error
      // and the row is now gone. Refresh the list instead of surfacing a failure.
      const notFound =
        (data?.error && /not found/i.test(String(data.error))) ||
        (error?.message && /not found|404/i.test(error.message));
      if (!notFound) {
        if (error) throw new Error(error.message || "Edge function failed");
        if (data?.error) throw new Error(data.error);
      }
      queryClient.invalidateQueries({ queryKey: queryKeys.adminCompetitions() });
      queryClient.invalidateQueries({ queryKey: queryKeys.adminEntries() });
    }, { successMessage: "Competition permanently deleted with all related data" });
    setHardDeleting(false);
    setHardDeleteTarget(null);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <span className="text-[9px] tracking-[0.3em] uppercase text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>
          {competitions.length} competition{competitions.length !== 1 ? "s" : ""}
        </span>
        <button onClick={() => { resetForm(); setShowForm(true); }}
          className="inline-flex items-center gap-2 text-xs tracking-[0.15em] uppercase px-5 py-2.5 bg-primary text-primary-foreground hover:opacity-90 transition-opacity duration-500"
          style={{ fontFamily: "var(--font-heading)" }}>
          <Plus className="h-3.5 w-3.5" /> New Competition
        </button>
      </div>

      {showForm && (
        <div className="border border-border p-6 md:p-8 mb-8 space-y-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs tracking-[0.2em] uppercase text-primary" style={{ fontFamily: "var(--font-heading)" }}>
              {editingId ? "Edit Competition" : "New Competition"}
            </span>
            <button onClick={resetForm} className="text-muted-foreground hover:text-foreground"><XCircle className="h-4 w-4" /></button>
          </div>
          <div className="grid md:grid-cols-2 gap-5">
            <FormField label="Title *" value={form.title} onChange={(v) => setForm((f) => ({ ...f, title: v }))} placeholder="Competition title" />
            <FormField label="Category" value={form.category} onChange={(v) => setForm((f) => ({ ...f, category: v }))} placeholder="e.g. Wildlife, Street" />
            <CoverImageUploader value={form.cover_image_url} onChange={(url) => setForm(f => ({ ...f, cover_image_url: url }))} recommendedWidth={1200} recommendedHeight={400} bucket="competition-photos" folder="covers" />
            <FormField label="Entry Fee ($)" value={form.entry_fee} onChange={(v) => setForm((f) => ({ ...f, entry_fee: v }))} placeholder="0" type="number" />
            <FormField label="Prize Info" value={form.prize_info} onChange={(v) => setForm((f) => ({ ...f, prize_info: v }))} placeholder="e.g. $500 grand prize" />
            <FormField label="Max Entries/User" value={form.max_entries_per_user} onChange={(v) => setForm((f) => ({ ...f, max_entries_per_user: v }))} type="number" />
            <FormField label="Max Photos/Entry" value={form.max_photos_per_entry} onChange={(v) => setForm((f) => ({ ...f, max_photos_per_entry: v }))} type="number" />
            <FormField label="Submission Opens *" value={form.starts_at} onChange={(v) => setForm((f) => ({ ...f, starts_at: v }))} type="datetime-local" />
            <FormField label="Submission Closes *" value={form.ends_at} onChange={(v) => setForm((f) => ({ ...f, ends_at: v }))} type="datetime-local" />
            <FormField label="Voting Ends" value={form.voting_ends_at} onChange={(v) => setForm((f) => ({ ...f, voting_ends_at: v }))} type="datetime-local" />
          </div>
          <div className="flex items-center gap-3 py-3 px-4 border border-border bg-muted/20">
            <input type="checkbox" checked={form.ai_images_allowed} onChange={(e) => setForm((f) => ({ ...f, ai_images_allowed: e.target.checked }))} className="h-4 w-4 accent-primary" />
            <div>
              <span className="text-xs font-medium" style={{ fontFamily: "var(--font-heading)" }}>Allow AI-Generated Images</span>
              <p className="text-[10px] text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>If unchecked, participants must declare whether their submission is AI-generated.</p>
            </div>
          </div>
          <div>
            <label className="block text-[10px] tracking-[0.2em] uppercase text-muted-foreground mb-2" style={{ fontFamily: "var(--font-heading)" }}>Description</label>
            <textarea value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} rows={3}
              className="w-full bg-transparent border border-border focus:border-primary outline-none p-4 text-sm transition-colors duration-500 resize-none"
              placeholder="Describe this competition..." style={{ fontFamily: "var(--font-body)" }} />
          </div>
          {parseFloat(form.entry_fee) > 0 && (
            <div className="border border-border/50 p-5 space-y-4">
              <span className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>Payment Details</span>
              <div className="grid md:grid-cols-2 gap-5">
                <FormField label="PayPal Email" value={form.paypal_email} onChange={(v) => setForm((f) => ({ ...f, paypal_email: v }))} placeholder="payments@example.com" />
                <FormField label="UPI ID" value={form.upi_id} onChange={(v) => setForm((f) => ({ ...f, upi_id: v }))} placeholder="name@upi" />
              </div>
              <div>
                <label className="block text-[10px] tracking-[0.2em] uppercase text-muted-foreground mb-2" style={{ fontFamily: "var(--font-heading)" }}>Bank Details</label>
                <textarea value={form.bank_details} onChange={(e) => setForm((f) => ({ ...f, bank_details: e.target.value }))} rows={2}
                  className="w-full bg-transparent border border-border focus:border-primary outline-none p-4 text-sm transition-colors duration-500 resize-none"
                  placeholder="Bank name, Account number, IFSC, etc." style={{ fontFamily: "var(--font-body)" }} />
              </div>
            </div>
          )}
          {editingId && user ? (
            <Suspense fallback={<div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>}>
              <div className="grid md:grid-cols-2 gap-4">
                <AdminCompetitionJudges competitionId={editingId} adminId={user.id} />
                <AdminCompetitionRounds competitionId={editingId} />
              </div>
              <RoundPublishPanel competitionId={editingId} />
              <JudgingDriftAudit competitionId={editingId} compact />
              <AwardsIntegrityAudit competitionId={editingId} compact />
            </Suspense>
          ) : (
            <div className="border border-dashed border-border px-4 py-3 flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground italic" style={{ fontFamily: "var(--font-body)" }}>Judges & rounds will be available after saving.</span>
              <button onClick={handleSave} disabled={saving || !form.title.trim() || !form.starts_at || !form.ends_at}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary text-primary-foreground text-[9px] tracking-[0.15em] uppercase hover:opacity-90 transition-opacity disabled:opacity-50"
                style={{ fontFamily: "var(--font-heading)" }}>
                {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} Save & Add Judges/Rounds
              </button>
            </div>
          )}
          <div className="flex gap-3 pt-2">
            <button onClick={handleSave} disabled={saving}
              className="inline-flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground text-xs tracking-[0.2em] uppercase hover:opacity-90 transition-opacity duration-500 disabled:opacity-50"
              style={{ fontFamily: "var(--font-heading)" }}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />} {editingId ? "Update" : "Create"}
            </button>
            <button onClick={resetForm} className="text-xs tracking-[0.15em] uppercase text-muted-foreground hover:text-foreground" style={{ fontFamily: "var(--font-heading)" }}>Cancel</button>
          </div>
        </div>
      )}

      {coverCropSrc && (
        <ImageCropModal imageSrc={coverCropSrc} onCropComplete={handleCoverCropComplete}
          onCancel={() => { if (coverCropSrc) URL.revokeObjectURL(coverCropSrc); setCoverCropSrc(null); }} />
      )}

      {/* Desktop Table */}
      <TooltipProvider delayDuration={150}>
      <div className="hidden md:block border border-border overflow-x-auto">
        <table className="w-full text-left table-fixed">
          <colgroup>
            <col className="w-[26%]" />
            <col className="w-[10%]" />
            <col className="w-[16%]" />
            <col className="w-[7%]" />
            <col className="w-[15%]" />
            <col className="w-[18%]" />
            <col className="w-[8%]" />
          </colgroup>
          <thead>
            <tr className="border-b border-border bg-muted/10">
              {([
                { key: "title", label: "Title" },
                { key: "category", label: "Category" },
                { key: "phase", label: "Status" },
                { key: null, label: "Fee" },
                { key: null, label: "Judges" },
                { key: "starts_at", label: "Schedule" },
                { key: null, label: "" },
              ] as { key: "title" | "category" | "phase" | "starts_at" | null; label: string }[]).map((h) => (
                <th key={h.label || "actions"}
                  className={`px-3 py-2.5 text-[9px] tracking-[0.2em] uppercase text-muted-foreground font-normal ${h.key ? "cursor-pointer select-none hover:text-foreground transition-colors" : ""}`}
                  style={{ fontFamily: "var(--font-heading)" }}
                  onClick={h.key ? () => toggleSort(h.key!) : undefined}
                >
                  <span className="inline-flex items-center gap-1">
                    {h.label}
                    {h.key && (
                      sortCol === h.key
                        ? (sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)
                        : <ArrowUpDown className="h-3 w-3 opacity-30" />
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {sortedCompetitions.map((comp) => {
              const PhaseIcon = phaseIcon(comp.phase);
              const judges = judgeNamesMap.get(comp.id) ?? [];
              const startStr = new Date(comp.starts_at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
              const endStr = new Date(comp.ends_at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
              const fullDateTooltip = `${new Date(comp.starts_at).toLocaleString()} → ${new Date(comp.ends_at).toLocaleString()}`;
              const canEdit = comp.phase !== "archived";
              return (
                <tr
                  key={comp.id}
                  onClick={() => canEdit ? openEdit(comp) : navigate(`/competitions/${comp.id}`)}
                  className="group hover:bg-muted/40 transition-colors duration-200 cursor-pointer"
                >
                  {/* Title */}
                  <td className="px-3 py-2.5 align-middle">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate group-hover:text-primary transition-colors" style={{ fontFamily: "var(--font-body)" }}>
                          {comp.title}
                        </div>
                        <div className="text-[9px] text-muted-foreground/60 tracking-wider mt-0.5 font-mono truncate">
                          #{comp.id.slice(0, 8)}
                        </div>
                      </div>
                    </div>
                  </td>

                  {/* Category */}
                  <td className="px-3 py-2.5 align-middle">
                    <span className="text-[10px] tracking-wider uppercase text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>
                      {comp.category}
                    </span>
                  </td>

                  {/* Status */}
                  <td className="px-3 py-2.5 align-middle">
                    <div className="flex flex-col gap-1 items-start">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span
                            className={`inline-flex items-center gap-1.5 text-[9px] tracking-[0.18em] uppercase px-2 py-1 border rounded-sm whitespace-nowrap ${phaseColor(comp.phase)}`}
                            style={{ fontFamily: "var(--font-heading)" }}
                          >
                            <PhaseIcon className="h-2.5 w-2.5" />
                            {phaseLabel(comp.phase)}
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="text-xs">
                          Phase: {phaseLabel(comp.phase)}
                        </TooltipContent>
                      </Tooltip>
                      <DriftBadge comp={comp} />
                    </div>
                  </td>

                  {/* Fee */}
                  <td className="px-3 py-2.5 align-middle">
                    <span className="inline-flex items-center gap-1 text-[11px] tabular-nums text-foreground/80">
                      <DollarSign className="h-3 w-3 text-muted-foreground" />
                      {comp.entry_fee ?? 0}
                    </span>
                  </td>

                  {/* Judges */}
                  <td className="px-3 py-2.5 align-middle">
                    {judges.length > 0 ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="inline-flex items-center gap-1.5 cursor-help">
                            <Users className="h-3 w-3 text-primary/70 shrink-0" />
                            <span className="text-[10px] text-foreground/80 truncate max-w-[120px]" title={judges.join(", ")}>
                              {judges[0]}{judges.length > 1 ? ` +${judges.length - 1}` : ""}
                            </span>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="text-xs max-w-[260px]">
                          <div className="font-semibold mb-1">{judges.length} judge{judges.length !== 1 ? "s" : ""}</div>
                          <div className="space-y-0.5">
                            {judges.map((n, i) => <div key={i}>· {n}</div>)}
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground/60 italic">
                        <Users className="h-3 w-3" /> None
                      </span>
                    )}
                  </td>

                  {/* Schedule */}
                  <td className="px-3 py-2.5 align-middle">
                    <div className="flex flex-col gap-0.5">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="inline-flex items-center gap-1.5 text-[10px] text-foreground/75 cursor-help whitespace-nowrap">
                            <Calendar className="h-3 w-3 text-muted-foreground shrink-0" />
                            <span className="tabular-nums">{startStr} → {endStr}</span>
                          </span>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="text-xs">{fullDateTooltip}</TooltipContent>
                      </Tooltip>
                      <RemainingTime comp={comp} compact />
                    </div>
                  </td>

                  {/* Actions */}
                  <td className="px-3 py-2.5 align-middle" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-end gap-0.5 opacity-60 group-hover:opacity-100 transition-opacity">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button onClick={() => navigate(`/competitions/${comp.id}`)} className="p-1.5 rounded hover:bg-primary/10 hover:text-primary transition-colors">
                            <Eye className="h-3.5 w-3.5" />
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="text-xs">View public page</TooltipContent>
                      </Tooltip>
                      {canEdit && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button onClick={() => openEdit(comp)} className="p-1.5 rounded hover:bg-primary/10 hover:text-primary transition-colors">
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="text-xs">Edit</TooltipContent>
                        </Tooltip>
                      )}
                      {canEdit && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button onClick={() => setArchiveTarget(comp.id)} className="p-1.5 rounded hover:bg-destructive/10 hover:text-destructive transition-colors">
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="text-xs">Archive</TooltipContent>
                        </Tooltip>
                      )}
                      {!canEdit && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button onClick={() => setHardDeleteTarget(comp.id)} className="p-1.5 rounded hover:bg-destructive/10 hover:text-destructive transition-colors">
                              <AlertTriangle className="h-3.5 w-3.5" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="text-xs">Delete permanently</TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {sortedCompetitions.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-muted-foreground">No competitions yet</td></tr>
            )}
          </tbody>
        </table>
      </div>
      </TooltipProvider>

      {/* Mobile Cards */}
      <div className="md:hidden space-y-2">
        {sortedCompetitions.map((comp) => {
          const PhaseIcon = phaseIcon(comp.phase);
          const canEdit = comp.phase !== "archived";
          return (
          <div
            key={comp.id}
            onClick={() => canEdit ? openEdit(comp) : navigate(`/competitions/${comp.id}`)}
            className="border border-border rounded-sm p-3 space-y-2 active:bg-muted/40 transition-colors cursor-pointer"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate" style={{ fontFamily: "var(--font-body)" }}>{comp.title}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{comp.category}</p>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap shrink-0">
                <span className={`inline-flex items-center gap-1 text-[9px] tracking-[0.15em] uppercase px-2 py-0.5 border rounded-sm ${phaseColor(comp.phase)}`} style={{ fontFamily: "var(--font-heading)" }}>
                  <PhaseIcon className="h-2.5 w-2.5" />
                  {phaseLabel(comp.phase)}
                </span>
                <DriftBadge comp={comp} />
              </div>
            </div>
            <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
              <span className="inline-flex items-center gap-1"><DollarSign className="h-3 w-3" />{comp.entry_fee ?? 0}</span>
              <span className="inline-flex items-center gap-1"><Calendar className="h-3 w-3" />{new Date(comp.starts_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })} → {new Date(comp.ends_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
              <RemainingTime comp={comp} compact />
            </div>
            {(judgeNamesMap.get(comp.id)?.length ?? 0) > 0 && (
              <div className="flex flex-wrap gap-1">{judgeNamesMap.get(comp.id)!.map((name, i) => (
                <span key={i} className="text-[8px] px-1.5 py-0.5 border border-primary/30 bg-primary/5 text-primary rounded-sm">{name}</span>
              ))}</div>
            )}
            <div className="flex items-center gap-1 pt-1 border-t border-border/50" onClick={(e) => e.stopPropagation()}>
              <button onClick={() => navigate(`/competitions/${comp.id}`)} className="p-1.5 hover:text-primary transition-colors"><Eye className="h-3.5 w-3.5" /></button>
              {canEdit && <button onClick={() => openEdit(comp)} className="p-1.5 hover:text-primary transition-colors"><Pencil className="h-3.5 w-3.5" /></button>}
              {canEdit && <button onClick={() => setArchiveTarget(comp.id)} className="p-1.5 hover:text-destructive transition-colors"><Trash2 className="h-3.5 w-3.5" /></button>}
              {!canEdit && <button onClick={() => setHardDeleteTarget(comp.id)} className="p-1.5 hover:text-destructive transition-colors"><AlertTriangle className="h-3.5 w-3.5" /></button>}
            </div>
          </div>
        );})}
        {competitions.length === 0 && (
          <div className="text-center py-10 border border-dashed border-border rounded-sm">
            <p className="text-sm text-muted-foreground">No competitions yet</p>
          </div>
        )}
      </div>

      <AlertDialog open={!!archiveTarget} onOpenChange={(open) => !open && setArchiveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive Competition</AlertDialogTitle>
            <AlertDialogDescription>
              This will archive the competition and hide it from public view. All entries will be preserved. This action is logged.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmArchive} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!hardDeleteTarget} onOpenChange={(open) => { if (!open && !hardDeleting) setHardDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" /> Permanently Delete Competition
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <span className="block font-semibold text-destructive">This action is IRREVERSIBLE.</span>
              <span className="block">This will permanently delete the competition and ALL connected data including:</span>
              <span className="block text-xs">• All entries & photos submitted by users</span>
              <span className="block text-xs">• All votes, scores, judge decisions & comments</span>
              <span className="block text-xs">• All judging rounds, sessions & assignments</span>
              <span className="block text-xs">• Payment details & vote adjustments</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={hardDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmHardDelete} disabled={hardDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {hardDeleting ? <><Loader2 className="h-4 w-4 animate-spin mr-1" /> Deleting…</> : "Delete Forever"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default CompetitionsModule;
