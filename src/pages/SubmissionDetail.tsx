import { useEffect, useState, useMemo, useCallback } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/core/useAuth";
import JudgingStampBadge from "@/components/JudgingStampBadge";
import ParticipantStageBadge from "@/components/judge/ParticipantStageBadge";
import UserNextStepPanel from "@/components/UserNextStepPanel";
import { motion, AnimatePresence } from "framer-motion";
import {
  Trophy, Star, Award, Camera, ChevronLeft, ChevronRight,
  X, Clock, CheckCircle, ExternalLink, ArrowLeft, ImageIcon, Pencil,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import EditEntryDialog from "@/components/competition/EditEntryDialog";
import { resolvePhase } from "@/lib/competitionPhase";
import PhaseWatermark from "@/components/competition/PhaseWatermark";
import { fetchPhotoStatusMaps, type PhotoStatusMap } from "@/lib/perPhotoStatus";
import { useEntryPublicStatus } from "@/hooks/judging/useEntryPublicStatus";
import type { PerPhotoStatus } from "@/hooks/judging/usePhotoDecisions";
import { buildPublishedParticipantTagMaps, type PublishedTagAssignment } from "@/lib/judging/publishedTagVisibility";
import { PARTICIPANT_PLACEMENT_LABELS, participantLabelForJudgingTag } from "@/lib/judging/participantStageLabels";

/* ── types ── */
interface ImageReport {
  photo_index: number;
  scores: { score: number; feedback: string | null }[];
  comments: string[];
  avg: number | null;
}
interface TagInfo { label: string; color: string; icon?: string; image_url?: string | null; }
interface EntryData {
  id: string; title: string; photos: string[]; status: string; placement: string | null;
  tags: TagInfo[]; tagsByPhoto: Record<number, TagInfo[]>; score_avg: number | null; image_reports: ImageReport[];
  /** Per-photo derived status (consensus from judge_decisions). */
  photo_status_map: PhotoStatusMap;
  /** FIX #3: per-photo titles from photo_meta[i].title (falls back to entry.title). */
  photo_titles: string[];
  /** FIX #4: per-photo admin-rejection metadata (visible to owner only). */
  photo_rejections: Array<{ rejected: boolean; reason: string | null; at: string | null }>;
}
interface CompData {
  id: string; title: string; status: string; phase: string; current_round: string | null; cover_image_url: string | null;
  ends_at: string | null;
}

const normalizePhotoIndex = (value: unknown): number => {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  const parsed = Number.parseInt(String(value ?? 0), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

const createDbPhotoIndexResolver = (totalPhotos: number, observedValues: unknown[]) => {
  const parsedValues = observedValues
    .map((value) => {
      if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
      const parsed = Number.parseInt(String(value ?? ""), 10);
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
    })
    .filter((value): value is number => value !== null);

  const hasZeroBasedEvidence = parsedValues.includes(0);
  const hasOneBasedEvidence = parsedValues.includes(1);
  const maxObserved = parsedValues.length > 0 ? Math.max(...parsedValues) : -1;
  const useOneBased = totalPhotos > 0 && !hasZeroBasedEvidence && hasOneBasedEvidence && maxObserved <= totalPhotos;

  return (value: unknown): number | null => {
    const parsed = normalizePhotoIndex(value);
    const resolved = useOneBased ? parsed - 1 : parsed;
    if (!Number.isFinite(resolved) || resolved < 0 || resolved >= totalPhotos) return null;
    return resolved;
  };
};

// Plan Phase 5 / Task 5.6 — labels sourced from PARTICIPANT_PLACEMENT_LABELS
// (mirror of v3_stage_catalog). Only gradient + emoji live here.
const PLACEMENT_CONFIG: Record<string, { label: string; gradient: string; emoji: string }> = {
  winner:          { label: PARTICIPANT_PLACEMENT_LABELS.winner,          gradient: "from-yellow-500 via-amber-400 to-yellow-600", emoji: "🏆" },
  "1st_runner_up": { label: PARTICIPANT_PLACEMENT_LABELS["1st_runner_up"], gradient: "from-slate-300 via-gray-200 to-slate-400",    emoji: "🥈" },
  "2nd_runner_up": { label: PARTICIPANT_PLACEMENT_LABELS["2nd_runner_up"], gradient: "from-amber-700 via-orange-600 to-amber-800",  emoji: "🥉" },
};

const PlacementBadge = ({ placement }: { placement: string }) => {
  const config = PLACEMENT_CONFIG[placement];
  if (!config) return null;
  return (
    <motion.div
      initial={{ scale: 0, rotate: -20 }}
      animate={{ scale: 1, rotate: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 15, delay: 0.2 }}
      className={`inline-flex items-center gap-2 px-4 py-2 rounded-full bg-gradient-to-r ${config.gradient} text-white shadow-lg`}
    >
      <motion.span
        animate={{ scale: [1, 1.3, 1] }}
        transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
        className="text-lg"
      >
        {config.emoji}
      </motion.span>
      <span className="text-xs tracking-[0.2em] uppercase font-bold" style={{ fontFamily: "var(--font-heading)" }}>
        {config.label}
      </span>
    </motion.div>
  );
};

/* ── Lightbox ── */
const SubmissionLightbox = ({
  photos, currentIndex, entry, imageReports, onClose, onNav,
  competitionPhase, competitionCurrentRound, scoresReleased, placementReleased,
  publicPlacement, publicStatus,
}: {
  photos: string[]; currentIndex: number; entry: EntryData;
  imageReports: ImageReport[]; onClose: () => void; onNav: (i: number) => void;
  competitionPhase?: string; competitionCurrentRound?: string | null;
  scoresReleased: boolean;
  placementReleased: boolean;
  publicPlacement: string | null;
  publicStatus: string;
}) => {
  const report = imageReports.find(r => r.photo_index === currentIndex);
  const photoTags = entry.tagsByPhoto[currentIndex] || [];
  const perPhotoTitle = entry.photo_titles[currentIndex] ?? entry.title;
  const rejection = entry.photo_rejections[currentIndex];
  // No silent "submitted" fallback — Phase 4 sentinel surfaces missing
  // consensus rather than masquerading as a successful "Under Review" state.
  const displayStatus = entry.photo_status_map[currentIndex] ?? "pending_consensus";

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" && currentIndex > 0) onNav(currentIndex - 1);
      if (e.key === "ArrowRight" && currentIndex < photos.length - 1) onNav(currentIndex + 1);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handler);
    return () => { document.body.style.overflow = ""; window.removeEventListener("keydown", handler); };
  }, [currentIndex, photos.length, onClose, onNav]);

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] bg-background/98 backdrop-blur-sm flex flex-col md:flex-row"
    >
      {/* Close */}
      <button onClick={onClose} className="absolute top-4 right-4 z-20 p-2 hover:bg-muted rounded-full transition-colors">
        <X className="h-5 w-5" />
      </button>

      {/* Image area */}
      <div className="flex-1 flex items-center justify-center relative min-w-0">
        {currentIndex > 0 && (
          <button onClick={() => onNav(currentIndex - 1)}
            className="absolute left-4 top-1/2 -translate-y-1/2 z-10 p-3 bg-muted/50 hover:bg-muted rounded-full transition-colors">
            <ChevronLeft className="h-6 w-6" />
          </button>
        )}
        {currentIndex < photos.length - 1 && (
          <button onClick={() => onNav(currentIndex + 1)}
            className="absolute right-4 top-1/2 -translate-y-1/2 z-10 p-3 bg-muted/50 hover:bg-muted rounded-full transition-colors">
            <ChevronRight className="h-6 w-6" />
          </button>
        )}

        <AnimatePresence mode="wait">
          <motion.img
            key={currentIndex}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.25 }}
            src={photos[currentIndex]}
            alt={`${perPhotoTitle} - Photo ${currentIndex + 1}`}
            className="max-w-[85vw] max-h-[75vh] object-contain"
            onContextMenu={(e) => e.preventDefault()}
            draggable={false}
          />
        </AnimatePresence>

        {competitionPhase && (
          <PhaseWatermark
            phase={competitionPhase}
            currentRound={competitionCurrentRound ?? null}
            surface="lightbox"
          />
        )}

        {/* Stamp overlay */}
        {photoTags.length > 0 && (
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-2">
            {photoTags.map(tag => (
                <JudgingStampBadge key={tag.label} label={participantLabelForJudgingTag(tag.label)} color={tag.color} icon={tag.icon} imageUrl={tag.image_url} size="md" />
            ))}
          </div>
        )}
      </div>

      {/* Right panel: scores */}
      <div className="w-full md:w-[300px] border-t md:border-t-0 md:border-l border-border bg-card flex flex-col shrink-0 overflow-y-auto p-4 space-y-4 max-h-[40vh] md:max-h-none">
        <div>
          <h3 className="text-sm font-light" style={{ fontFamily: "var(--font-display)" }}>{perPhotoTitle}</h3>
          <p className="text-[9px] text-muted-foreground mt-1" style={{ fontFamily: "var(--font-heading)" }}>
            Photo {currentIndex + 1} of {photos.length}
          </p>
          <div className="mt-2">
            <ParticipantStageBadge status={displayStatus} tags={[]} compact />
          </div>
          <div className="mt-2">
            <UserNextStepPanel status={displayStatus} compact />
          </div>
        </div>

        {/* FIX #4: Owner-visible admin-rejection notice. */}
        {rejection?.rejected && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 space-y-1">
            <p className="text-[10px] tracking-[0.2em] uppercase text-destructive font-semibold" style={{ fontFamily: "var(--font-heading)" }}>
              Removed by Moderation
            </p>
            <p className="text-[11px] text-foreground/90" style={{ fontFamily: "var(--font-body)" }}>
              {rejection.reason || "This image was removed from the public gallery and judging by an administrator."}
            </p>
            <p className="text-[9px] text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>
              It is hidden from voters and judges site-wide. Your other photos are unaffected.
            </p>
          </div>
        )}

        {/* Placement — Audit v6 P-01: gated via useEntryPublicStatus, never raw entry.placement. */}
        {placementReleased && (publicPlacement || publicStatus === "winner") && (
          <PlacementBadge placement={publicPlacement || "winner"} />
        )}

        {/* FIX #2: Score for this image — ONLY visible after results are declared. */}
        {scoresReleased && report && (
          <div className="space-y-2">
            <span className="text-[9px] tracking-[0.2em] uppercase text-muted-foreground block" style={{ fontFamily: "var(--font-heading)" }}>
              <Star className="h-3 w-3 inline mr-1" /> Score
            </span>
            {report.avg !== null && (
              <div className="flex items-center gap-2">
                <span className="text-2xl font-light text-primary" style={{ fontFamily: "var(--font-display)" }}>{report.avg}</span>
                <span className="text-xs text-muted-foreground">/10</span>
              </div>
            )}
            {report.scores.filter(s => s.feedback).map((s) => (
              <div key={`${s.score}-${s.feedback}`} className="text-[10px] p-2 bg-muted/30 border-l-2 border-primary/30" style={{ fontFamily: "var(--font-body)" }}>
                <span className="text-primary font-medium">{s.score}/10</span> — "{s.feedback}"
              </div>
            ))}
            {report.comments.map((c) => (
              <div key={c} className="text-[10px] p-2 bg-accent/10 border-l-2 border-accent/30 italic" style={{ fontFamily: "var(--font-body)" }}>
                💬 "{c}"
              </div>
            ))}
          </div>
        )}

        {/* FIX #2: Pre-results placeholder — communicates the SOW privacy gate. */}
        {!scoresReleased && (
          <div className="rounded-md border border-border/60 bg-muted/20 p-3">
            <p className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground font-semibold" style={{ fontFamily: "var(--font-heading)" }}>
              Scores Locked
            </p>
            <p className="text-[10px] text-muted-foreground/80 mt-1" style={{ fontFamily: "var(--font-body)" }}>
              Judges' marks and feedback are released only after results are declared.
            </p>
          </div>
        )}

        {/* FIX #2: Overall entry score — ONLY after results declared. */}
        {scoresReleased && entry.score_avg !== null && (
          <div className="pt-3 border-t border-border">
            <span className="text-[9px] tracking-[0.2em] uppercase text-muted-foreground block mb-1" style={{ fontFamily: "var(--font-heading)" }}>
              Overall Average
            </span>
            <span className="text-lg text-primary font-light" style={{ fontFamily: "var(--font-display)" }}>
              <Star className="h-4 w-4 inline fill-primary mr-1" />{entry.score_avg}/10
            </span>
          </div>
        )}

        {/* Tags */}
        {photoTags.length > 0 && (
          <div className="pt-3 border-t border-border">
            <span className="text-[9px] tracking-[0.2em] uppercase text-muted-foreground block mb-2" style={{ fontFamily: "var(--font-heading)" }}>
              <Award className="h-3 w-3 inline mr-1" /> Tags
            </span>
            <div className="flex flex-wrap gap-1.5">
              {photoTags.map(tag => (
                <JudgingStampBadge key={tag.label} label={participantLabelForJudgingTag(tag.label)} color={tag.color} icon={tag.icon} imageUrl={tag.image_url} size="sm" />
              ))}
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
};

/* ── Main Page ── */
const SubmissionDetail = () => {
  const { competitionId, entryId: urlEntryId, photoIndex: urlPhotoIndex } = useParams<{ competitionId: string; entryId?: string; photoIndex?: string }>();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [comp, setComp] = useState<CompData | null>(null);
  const [entries, setEntries] = useState<EntryData[]>([]);
  const [certificate, setCertificate] = useState<any>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxEntry, setLightboxEntry] = useState<EntryData | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNowTick(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  /** Audit v6 P-01/P-06: which rounds the admin has published — drives the
   *  participant-side reveal of tags, decisions, scores, comments, placement. */
  const [publishedRoundSet, setPublishedRoundSet] = useState<Set<number>>(new Set());

  // Judging v5: publish-gated status. Internal entry.status/placement is the
  // judge-side truth; we MUST hide winner/placement badges to the photographer
  // until the admin publishes the relevant round.
  const entryIds = useMemo(() => entries.map(e => e.id), [entries]);
  const { data: publicStatusMap = {} } = useEntryPublicStatus(entryIds);

  useEffect(() => {
    if (!authLoading && !user) navigate("/login");
  }, [user, authLoading, navigate]);

  useEffect(() => {
    if (!user || !competitionId) return;
    const fetch = async () => {
      setLoading(true);
      const [compRes, entriesRes] = await Promise.all([
        supabase.from("competitions").select("id, title, status, phase, cover_image_url, starts_at, ends_at, voting_ends_at, judging_completed, current_round").eq("id", competitionId).single(),
        supabase.from("competition_entries").select("id, title, photos, photo_meta, status, placement, current_round, progression_decision").eq("competition_id", competitionId).eq("user_id", user.id),
      ]);
      if (compRes.data) setComp({ ...compRes.data, phase: resolvePhase(compRes.data as any), current_round: (compRes.data as any).current_round ?? null });
      if (entriesRes.data && entriesRes.data.length > 0) {
        const entryIds = entriesRes.data.map(e => e.id);
        // Fetch publish ledger FIRST so we can pass `publishedRounds` into
        // `fetchPhotoStatusMaps`. Without this gate, an in-progress later
        // round (e.g. R3 closed but admin has not yet declared) leaks
        // promotion labels onto the per-photo badges. Observed 2026-05-02:
        // photo 8 of entry 9549bd4c… showed "Shortlisted for Final Round"
        // while the rest of the entry still showed "Qualified for Round 2"
        // even though R3 had not been declared.
        const publishRes = await supabase
          .from("competition_round_publish")
          .select("round_number, published_at, closed_at")
          .eq("competition_id", competitionId);
        const publishedRoundsForFetch = new Set<number>(
          ((publishRes as any)?.data || [])
            .filter((r: any) => r.published_at != null)
            .map((r: any) => Number(r.round_number)),
        );
        const [tagAssignRes, scoresRes, commentsRes, photoStatusMaps, roundsRes, r1DecisionsRes] = await Promise.all([
          // HOTFIX-G: publish-gated owner-safe views (no judge_id leak).
          supabase.from("judge_tag_assignments_owner_safe" as any).select("entry_id, tag_id, photo_index, created_at").in("entry_id", entryIds),
          supabase.from("judge_scores").select("entry_id, score, feedback, photo_index").in("entry_id", entryIds),
          supabase.from("judge_comments_owner_safe" as any).select("entry_id, comment, photo_index").in("entry_id", entryIds),
          fetchPhotoStatusMaps(entryIds, [competitionId], { viewerRole: "owner", publishedRounds: publishedRoundsForFetch }),
          supabase.from("judging_rounds").select("round_number, status").eq("competition_id", competitionId),
          // Phase B: pull per-photo R1 raw decisions so we can lock R1 outcomes
          // (accept→r1_accepted, reject→rejected, shortlist→round1_qualified)
          // even after R2 has started and the latest-round RPC begins to leak
          // R2 statuses on the same photo_index.
          // HOTFIX-F1-PLUS: read from owner-safe view (no judge_id leak).
          supabase.from("judge_decisions_owner_safe" as any).select("entry_id, photo_index, decision, round_number").in("entry_id", entryIds).eq("round_number", 1),
          // Audit v6 P-01/P-06: the participant-side reveal of judge tags,
          // per-photo decisions, scores, and comments is gated on
          // competition_round_publish.published_at IS NOT NULL — Rule #6.
          // judging_rounds.status='completed' is a judge-side signal and
          // MUST NOT be used to gate participant visibility.
          supabase.from("competition_round_publish").select("round_number, published_at").eq("competition_id", competitionId),
        ]);

        const resolverByEntry = new Map<string, (value: unknown) => number | null>(
          entriesRes.data.map((entry) => {
            const observedValues = [
              ...((tagAssignRes.data || []).filter((row: any) => row.entry_id === entry.id).map((row: any) => row.photo_index)),
              ...((scoresRes.data || []).filter((row: any) => row.entry_id === entry.id).map((row: any) => row.photo_index)),
              ...((commentsRes.data || []).filter((row: any) => row.entry_id === entry.id).map((row: any) => row.photo_index)),
              ...(((r1DecisionsRes as any)?.data || []).filter((row: any) => row.entry_id === entry.id).map((row: any) => row.photo_index)),
              ...Object.keys(photoStatusMaps.get(entry.id) ?? {}).map(Number),
            ];
            return [entry.id, createDbPhotoIndexResolver(entry.photos.length, observedValues)];
          }),
        );

        // SOW Visibility Matrix (Rule #6): tags / per-photo decisions / scores
        // are revealed per-round only after that round's published_at is set
        // by the admin (publish-round edge function). Until then the
        // participant sees the locked "judging_in_progress" view.
        const publishedRounds = new Set<number>(
          ((publishRes as any)?.data || [])
            .filter((r: any) => r.published_at != null)
            .map((r: any) => Number(r.round_number)),
        );
        const r1Published = publishedRounds.has(1);
        const anyRoundPublished = publishedRounds.size > 0;
        setPublishedRoundSet(publishedRounds);

        // Per-photo R1 majority decision (only consulted when R1 is completed).
        // Map: entry_id → photo_index → 'accept' | 'reject' | 'shortlist' | 'needs_review'
        const r1PhotoDecisionMap: Record<string, Record<number, string>> = {};
        if (r1Published) {
          const tally: Record<string, Record<number, Record<string, number>>> = {};
          ((r1DecisionsRes as any)?.data || []).forEach((d: any) => {
            const eid = d.entry_id;
            const pi = resolverByEntry.get(eid)?.(d.photo_index);
            if (pi == null) return;
            const dec = String(d.decision || "").toLowerCase();
            if (!dec) return;
            tally[eid] ??= {};
            tally[eid][pi] ??= {};
            tally[eid][pi][dec] = (tally[eid][pi][dec] || 0) + 1;
          });
          // SOW priority tie-break: shortlist > accept > needs_review > reject
          const priority = ["shortlist", "accept", "needs_review", "reject"];
          Object.entries(tally).forEach(([eid, byPhoto]) => {
            r1PhotoDecisionMap[eid] = {};
            Object.entries(byPhoto).forEach(([piStr, counts]) => {
              const pi = Number(piStr);
              let best: string | null = null;
              let bestCount = -1;
              priority.forEach((dec) => {
                const c = counts[dec] || 0;
                if (c > bestCount) { best = dec; bestCount = c; }
              });
              if (best && bestCount > 0) r1PhotoDecisionMap[eid][pi] = best;
            });
          });
        }

        // Tags: first normalize ALL assignments, then apply the publish gate,
        // then keep the latest VISIBLE assignment per entry+photo. The previous
        // order kept the latest raw assignment first, so an undeclared R3/R4 tag
        // could hide the earlier declared R2 tag — or derive an unpublished
        // participant label before admin declaration.
        const normalizedTagAssignments: PublishedTagAssignment[] = [];
        (tagAssignRes.data || []).forEach((t: any) => {
          const photoIndex = resolverByEntry.get(t.entry_id)?.(t.photo_index);
          if (photoIndex == null) return;
          normalizedTagAssignments.push({
            entry_id: t.entry_id,
            tag_id: t.tag_id,
            photo_index: photoIndex,
            created_at: t.created_at ?? null,
          });
        });

        const uniqueTagIds = [...new Set(normalizedTagAssignments.map((t) => t.tag_id))];
        let tagInfoMap = new Map<string, TagInfo>();
        let tagRoundMap = new Map<string, number[]>();
        if (uniqueTagIds.length > 0) {
          const { data: tagsData } = await supabase.from("judging_tags" as any).select("id, label, color, icon, image_url, visible_in_round").in("id", uniqueTagIds);
          (tagsData as any[] || []).forEach((t: any) => {
            tagInfoMap.set(t.id, { label: t.label, color: t.color, icon: t.icon, image_url: t.image_url });
            tagRoundMap.set(t.id, Array.isArray(t.visible_in_round) ? t.visible_in_round.map((n: any) => Number(n)) : []);
          });
        }
        const { entryTagMap, entryTagsByPhotoMap, tagDerivedStatusByEntryPhoto } = buildPublishedParticipantTagMaps(
          normalizedTagAssignments,
          tagInfoMap,
          tagRoundMap,
          publishedRounds,
        );

        // Scores & reports
        const normalizedScores = (scoresRes.data || []).flatMap((s: any) => {
          const photoIndex = resolverByEntry.get(s.entry_id)?.(s.photo_index);
          return photoIndex == null ? [] : [{ ...s, photo_index: photoIndex }];
        });
        const normalizedComments = (commentsRes.data || []).flatMap((c: any) => {
          const photoIndex = resolverByEntry.get(c.entry_id)?.(c.photo_index);
          return photoIndex == null ? [] : [{ ...c, photo_index: photoIndex }];
        });

        const scoreMap: Record<string, { avg: number; count: number }> = {};
        const imageReportMap: Record<string, Record<number, ImageReport>> = {};
        normalizedScores.forEach((s: any) => {
          if (!scoreMap[s.entry_id]) scoreMap[s.entry_id] = { avg: 0, count: 0 };
          scoreMap[s.entry_id].avg += s.score;
          scoreMap[s.entry_id].count += 1;
          if (!imageReportMap[s.entry_id]) imageReportMap[s.entry_id] = {};
          if (!imageReportMap[s.entry_id][s.photo_index]) imageReportMap[s.entry_id][s.photo_index] = { photo_index: s.photo_index, scores: [], comments: [], avg: null };
          imageReportMap[s.entry_id][s.photo_index].scores.push({ score: s.score, feedback: s.feedback });
        });
        normalizedComments.forEach((c: any) => {
          if (!imageReportMap[c.entry_id]) imageReportMap[c.entry_id] = {};
          if (!imageReportMap[c.entry_id][c.photo_index]) imageReportMap[c.entry_id][c.photo_index] = { photo_index: c.photo_index, scores: [], comments: [], avg: null };
          imageReportMap[c.entry_id][c.photo_index].comments.push(c.comment);
        });
        Object.values(scoreMap).forEach(s => { s.avg = Math.round((s.avg / s.count) * 10) / 10; });
        Object.values(imageReportMap).forEach(entryReports => {
          Object.values(entryReports).forEach(r => {
            if (r.scores.length > 0) r.avg = Math.round((r.scores.reduce((s, sc) => s + sc.score, 0) / r.scores.length) * 10) / 10;
          });
        });

        setEntries(entriesRes.data.map(e => {
          const meta: any[] = Array.isArray((e as any).photo_meta) ? (e as any).photo_meta : [];
          const photo_titles = e.photos.map((_, i) => {
            const t = meta[i]?.title;
            return typeof t === "string" && t.trim().length > 0 ? t : (e.title || "Untitled");
          });
          const photo_rejections = e.photos.map((_, i) => ({
            rejected: meta[i]?.rejected === true,
            reason: typeof meta[i]?.rejected_reason === "string" ? meta[i].rejected_reason : null,
            at: typeof meta[i]?.rejected_at === "string" ? meta[i].rejected_at : null,
          }));

          // FIX: Per-photo status fallback chain — RPC map first, then per-photo
          // admin rejection, then derive from entry progression (post round-close
          // truth: status / progression_decision / current_round). This eliminates
          // the silent "submitted → Under Review" fallback that fired whenever
          // get_per_photo_consensus returned no row for a photo.
          const rpcMap = Object.fromEntries(
            Object.entries(photoStatusMaps.get(e.id) ?? {}).flatMap(([photoIndex, status]) => {
              const resolved = resolverByEntry.get(e.id)?.(Number(photoIndex));
              return resolved == null ? [] : [[resolved, status]];
            }),
          ) as PhotoStatusMap;
          // Phase 6 / Step 6.2 — Audit v6 P-01/P-06 hardening.
          // Single source of truth: useEntryPublicStatus → useGatedEntryStatus.
          // Replaces all prior raw `(e as any).status` / `progression_decision`
          // reads + ad-hoc per-round IIFE gates + deriveFromEntry() mapping.
          // The gated `public_status` already encodes:
          //   - publish-gate (competition_round_publish.published_at)
          //   - verification override (photo_verification_requests)
          //   - phase-3 pending-photo gate (any_photo_pending → judging_in_progress)
          // No legacy decision tokens (accept/reject/qualified/shortlisted-as-token)
          // are ever read here. Awards (winner/runner_up/honorary/special_jury)
          // surface through `public_placement` rendered by <PlacementBadge/>.
          const gatedStatus = publicStatusMap[e.id]?.public_status ?? null;
          // Map the gated participant-facing status to the per-photo union.
          // `judging_in_progress` (and any unknown) collapses to null so the
          // existing "submitted → Under Review" fallback (line below) fires —
          // identical UX to the prior `entryDerived === null` path.
          const PHOTO_STATUS_WHITELIST: ReadonlySet<PerPhotoStatus> = new Set([
            "submitted","round1_qualified","round2_qualified",
            "shortlisted","finalist","winner","rejected","needs_review",
          ]);
          const entryDerived: PerPhotoStatus | null =
            gatedStatus && PHOTO_STATUS_WHITELIST.has(gatedStatus as PerPhotoStatus)
              ? (gatedStatus as PerPhotoStatus)
              : null;
          const r1ByPhoto = r1PhotoDecisionMap[e.id] || {};
          const photo_status_map: PhotoStatusMap = {};
          e.photos.forEach((_, i) => {
            // 1. Admin-removed photos always render as rejected.
            if (photo_rejections[i].rejected) { photo_status_map[i] = "rejected"; return; }

            // 2. Trust the publish-gated RPC.
            //    `fetchPhotoStatusMaps` already drops every round whose
            //    `competition_round_publish.published_at` is NULL and keeps
            //    the highest published round per photo (R2 wins over R1, etc.).
            //    This is the byte-true answer to the user's mapping rules:
            //      R1 accept       → r1_accepted        ("Accepted")
            //      R1 reject       → rejected           ("Rejected")
            //      R1 shortlist    → r1_shortlisted_r2  ("Qualified for Round 2")
            //      R2 accept       → r2_accepted        ("Qualified for Round 2")
            //      R2 qualified_r3 → r2_qualified_r3    ("Shortlisted for Round 3")
            //      R3/R4 results   → only surface AFTER admin declares the round.
            //
            //    Note: `buildPhotoStatusMaps` aliases `r2_qualified_r3` →
            //    `round2_qualified` and `r3_qualified_final` → `finalist` for
            //    legacy callers; the participant labels for both legacy + v3
            //    keys resolve to the same string via PARTICIPANT_STAGE_LABELS,
            //    so there is no UX divergence.
            const fromRpc = (rpcMap as any)[i];
            const rpcUsable = fromRpc && fromRpc !== "pending_consensus" && fromRpc !== "submitted";
            if (rpcUsable) { photo_status_map[i] = fromRpc; return; }

            // 3. RPC silent (no consensus / no row) but R1 is published —
            //    derive directly from the per-photo R1 raw decision.
            if (r1Published) {
              const r1 = r1ByPhoto[i];
              if (r1 === "reject")        { photo_status_map[i] = "rejected";          return; }
              if (r1 === "accept")        { photo_status_map[i] = "r1_accepted";       return; }
              if (r1 === "shortlist")     { photo_status_map[i] = "r1_shortlisted_r2"; return; }
              if (r1 === "needs_review")  { photo_status_map[i] = "r1_needs_review";   return; }
              const tagDerived = tagDerivedStatusByEntryPhoto[e.id]?.[i];
              if (tagDerived) { photo_status_map[i] = tagDerived; return; }
            }

            // 4. Last resort: gated entry-level status, then "submitted".
            if (entryDerived) { photo_status_map[i] = entryDerived as PerPhotoStatus; return; }
            photo_status_map[i] = "submitted";
          });

          return {
            ...e,
            tags: entryTagMap[e.id] || [],
            tagsByPhoto: entryTagsByPhotoMap[e.id] || {},
            score_avg: scoreMap[e.id]?.avg || null,
            image_reports: imageReportMap[e.id] ? Object.values(imageReportMap[e.id]).sort((a, b) => a.photo_index - b.photo_index) : [],
            photo_status_map,
            photo_titles,
            photo_rejections,
          };
        }));
      }

      // Certificate (Ruleset v4: hide revoked certs from participant submission view)
      // reference_id is the ENTRY id for certs written by Certificates.tsx
      // handleRequest, and the COMPETITION id for legacy rows — dual-match both.
      const certRefIds = [competitionId!, ...(entriesRes.data || []).map(e => e.id)];
      const { data: cert } = await supabase.from("certificates").select("id").eq("user_id", user.id).in("reference_id", certRefIds).eq("is_revoked", false).limit(1);
      setCertificate(cert?.[0] || null);
      setLoading(false);
    };
    fetch();
  }, [user, competitionId, refreshKey]);

  const openLightbox = useCallback((entry: EntryData, photoIndex: number) => {
    setLightboxEntry(entry);
    setLightboxIndex(photoIndex);
    setLightboxOpen(true);
  }, []);

  // (Verification workflow removed Apr 2026 — Needs Review now flows via
  // a transactional email + in-app notification fired by the publish-round
  // edge function. No participant upload UI is needed.)

  // URL ↔ lightbox sync (Facebook-style per-photo URLs)
  const baseSubmissionPath = competitionId ? `/dashboard/submission/${competitionId}` : null;

  // Open lightbox from URL on mount / change
  useEffect(() => {
    if (!urlEntryId || urlPhotoIndex === undefined || entries.length === 0) return;
    const target = entries.find((e) => e.id === urlEntryId);
    if (!target) return;
    const pi = Number.parseInt(urlPhotoIndex, 10);
    if (!Number.isFinite(pi) || pi < 0 || pi >= target.photos.length) return;
    setLightboxEntry(target);
    setLightboxIndex(pi);
    setLightboxOpen(true);
  }, [urlEntryId, urlPhotoIndex, entries]);

  // Push URL when lightbox photo changes
  useEffect(() => {
    if (!baseSubmissionPath) return;
    if (lightboxOpen && lightboxEntry) {
      const target = `${baseSubmissionPath}/entry/${lightboxEntry.id}/photo/${lightboxIndex}`;
      if (window.location.pathname !== target) {
        navigate(target, { replace: true });
      }
    } else if (urlEntryId) {
      navigate(baseSubmissionPath, { replace: true });
    }
  }, [lightboxOpen, lightboxEntry, lightboxIndex, baseSubmissionPath, navigate, urlEntryId]);

  if (authLoading || loading) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center">
        <span className="text-xs tracking-[0.3em] uppercase text-muted-foreground animate-pulse" style={{ fontFamily: "var(--font-heading)" }}>Loading...</span>
      </main>
    );
  }

  if (!comp) {
    return (
      <main className="min-h-screen bg-background p-8 text-center">
        <p className="text-muted-foreground">Competition not found.</p>
        <Link to="/dashboard?tab=submissions" className="text-primary hover:underline text-sm mt-2 inline-block">← Back to Dashboard</Link>
      </main>
    );
  }

  const compPhase = comp.phase || "submission_open";
  // Audit v6 P-01/P-06: judges' marks become visible only after Round 4
  // (final results) is published. Phase==="result" alone is not enough —
  // the admin must have hit "Publish Round 4" on the publish panel.
  const scoresReleased = publishedRoundSet.has(4);
  // Award placement (winner / runner-up) is also a Round 4 reveal.
  const placementReleased = publishedRoundSet.has(4);
  const compStatusLabel = compPhase === "result" ? "Results Declared" : compPhase === "judging" ? "Judging in Progress" : "Open";

  // Owner edit window: phase MUST be submission_open AND now() <= ends_at.
  // Mirrors the DB RLS USING clause exactly. RLS is the source of truth;
  // this just controls UI visibility.
  const endsAtMs = comp.ends_at ? new Date(comp.ends_at).getTime() : 0;
  const editWindowOpen =
    compPhase === "submission_open" &&
    endsAtMs > 0 &&
    nowTick <= endsAtMs &&
    !["archived", "cancelled"].includes(comp.status);
  const editClosesInLabel = (() => {
    if (!editWindowOpen) return null;
    const ms = endsAtMs - nowTick;
    const m = Math.floor(ms / 60_000);
    const d = Math.floor(m / (60 * 24));
    const h = Math.floor((m - d * 60 * 24) / 60);
    const mm = m - d * 60 * 24 - h * 60;
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${mm}m`;
    return `${mm}m`;
  })();

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="container mx-auto py-3 md:py-6 max-w-5xl">

        {/* Hero */}
        <div className="relative rounded-xl md:rounded-sm overflow-hidden mb-4 md:mb-6">
          {comp.cover_image_url ? (
            <img src={comp.cover_image_url} alt={comp.title} className="w-full h-36 md:h-64 object-cover" loading="lazy" />
          ) : (
            <div className="w-full h-36 md:h-64 bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center">
              <Trophy className="h-12 w-12 text-primary/30" />
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
          <div className="absolute bottom-0 left-0 right-0 p-3 md:p-5">
            <h1 className="text-base md:text-2xl font-light text-white" style={{ fontFamily: "var(--font-display)" }}>{comp.title}</h1>
            <div className="flex items-center gap-3 mt-2 flex-wrap">
              <span className="inline-flex items-center gap-1 text-[9px] tracking-[0.15em] uppercase px-2.5 py-1 border border-white/30 text-white/80 rounded-full" style={{ fontFamily: "var(--font-heading)" }}>
                {compPhase === "result" ? <CheckCircle className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
                {compStatusLabel}
              </span>
              {entries.length > 0 && (
                <span className="text-white/60 text-[10px]" style={{ fontFamily: "var(--font-heading)" }}>
                  {entries.length} {entries.length === 1 ? "entry" : "entries"} submitted
                </span>
              )}
              {certificate && (
                <Link to="/certificates" className="inline-flex items-center gap-1 text-[9px] tracking-[0.15em] uppercase text-yellow-400 hover:underline" style={{ fontFamily: "var(--font-heading)" }}>
                  <Award className="h-3 w-3" /> View Certificate
                </Link>
              )}
            </div>
            {/* Placement badges — Audit v6 P-01: gated via useEntryPublicStatus, never raw entry.placement. */}
            <div className="flex gap-2 mt-3 flex-wrap">
              {placementReleased && entries.map(e => {
                const ps = publicStatusMap[e.id];
                const visiblePlacement = ps?.public_placement ?? null;
                const visibleStatus = ps?.public_status ?? "judging_in_progress";
                if (!visiblePlacement && visibleStatus !== "winner") return null;
                return <PlacementBadge key={e.id} placement={visiblePlacement || "winner"} />;
              })}
            </div>
          </div>
        </div>

        {/* Entries */}
        {entries.map((entry, ei) => (
          <motion.div
            key={entry.id}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: ei * 0.1, duration: 0.4 }}
            className="mb-8"
          >
            <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
              <div className="flex items-center gap-2">
                {entries.length > 1 && (
                  <h2 className="text-sm font-light" style={{ fontFamily: "var(--font-display)" }}>{entry.title}</h2>
                )}
                {/* Entry-level header badge removed — per-photo policy. Each tile renders its own status. */}
                <span className="text-[9px] tracking-[0.15em] uppercase text-muted-foreground" style={{ fontFamily: "var(--font-heading)" }}>
                  {entry.photos.length} {entry.photos.length === 1 ? "image" : "images"} · status shown per image
                </span>
              </div>
              <div className="flex items-center gap-2">
                {scoresReleased && entry.score_avg !== null && (
                  <span className="text-sm text-primary inline-flex items-center gap-1" style={{ fontFamily: "var(--font-display)" }}>
                    <Star className="h-4 w-4 fill-primary" />{entry.score_avg}/10
                  </span>
                )}
                {editWindowOpen && (
                  <>
                    <span
                      className="text-[9px] tracking-[0.15em] uppercase px-2 py-0.5 border border-primary/40 text-primary rounded-full"
                      style={{ fontFamily: "var(--font-heading)" }}
                      title={`Edit window closes at ${new Date(endsAtMs).toLocaleString()}`}
                    >
                      Edit closes in {editClosesInLabel}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 px-2.5 text-[10px] tracking-[0.15em] uppercase"
                      onClick={() => setEditingEntryId(entry.id)}
                    >
                      <Pencil className="h-3 w-3 mr-1.5" />
                      Edit
                    </Button>
                  </>
                )}
              </div>
            </div>

            {/* Tags */}
            {entry.tags.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-4">
                {entry.tags.map(tag => (
                  <JudgingStampBadge key={tag.label} label={participantLabelForJudgingTag(tag.label)} color={tag.color} icon={tag.icon} imageUrl={tag.image_url} size="md" />
                ))}
              </div>
            )}

            {/* XL Image Grid */}
            <div className="grid grid-cols-2 gap-2 md:gap-3">
              {entry.photos.map((photo, pi) => {
                const report = entry.image_reports.find(r => r.photo_index === pi);
                const photoTags = entry.tagsByPhoto[pi] || [];
                const photoStatus = entry.photo_status_map[pi] ?? "pending_consensus";
                const photoTitle = entry.photo_titles[pi] ?? entry.title;
                const photoRejection = entry.photo_rejections[pi];
                return (
                  <motion.div
                    key={`${entry.id}-photo-${pi}`}
                    whileHover={{ scale: 1.02 }}
                    transition={{ duration: 0.2 }}
                    className="relative cursor-pointer group overflow-hidden border-2 border-border hover:border-primary/50 transition-colors"
                    onClick={() => openLightbox(entry, pi)}
                  >
                    <div className="aspect-[4/3] overflow-hidden">
                      <img
                        src={photo}
                        alt={`${photoTitle} - Photo ${pi + 1}`}
                        className={`w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 ${photoRejection?.rejected ? "opacity-60 grayscale" : ""}`}
                        loading="lazy"
                        onContextMenu={(e) => e.preventDefault()}
                        draggable={false}
                      />
                    </div>
                    {comp?.phase && (
                      <PhaseWatermark
                        phase={comp.phase}
                        currentRound={comp.current_round ?? null}
                        surface="card"
                      />
                    )}

                    {/* FIX #4: Owner-visible "Removed by Moderation" ribbon. */}
                    {photoRejection?.rejected && (
                      <div className="absolute inset-x-0 top-0 bg-destructive text-destructive-foreground px-3 py-1.5 text-[10px] tracking-[0.18em] uppercase font-semibold text-center" style={{ fontFamily: "var(--font-heading)" }}>
                        Removed by Moderation{photoRejection.reason ? ` — ${photoRejection.reason}` : ""}
                      </div>
                    )}

                    {/* FIX #2: Score badge — only after results declared */}
                    {scoresReleased && report?.avg !== null && report?.avg !== undefined && (
                      <div className="absolute top-3 right-3 bg-background/80 backdrop-blur-sm text-foreground rounded-full px-3 py-1 text-xs font-semibold flex items-center gap-1">
                        <Star className="h-3 w-3 fill-primary text-primary" />{report.avg}/10
                      </div>
                    )}

                    {/* Stamp overlay */}
                    {photoTags.length > 0 && (
                      <div className="absolute bottom-0 left-0 right-0 flex items-center gap-1.5 px-3 py-2 bg-gradient-to-t from-black/70 to-transparent">
                        {photoTags.map(tag => (
                          <JudgingStampBadge key={tag.label} label={participantLabelForJudgingTag(tag.label)} color={tag.color} icon={tag.icon} imageUrl={tag.image_url} size="sm" />
                        ))}
                      </div>
                    )}

                    {/* Per-photo status badge — strict per-image policy */}
                    <div className="absolute top-3 left-3 flex flex-col gap-1.5">
                      <ParticipantStageBadge status={photoStatus} tags={[]} compact />
                      {pi === 0 && (() => {
                        const ps = publicStatusMap[entry.id];
                        const visiblePlacement = ps?.public_placement ?? null;
                        const visibleStatus = ps?.public_status ?? "judging_in_progress";
                        if (!visiblePlacement && visibleStatus !== "winner") return null;
                        return <PlacementBadge placement={visiblePlacement || "winner"} />;
                      })()}
                    </div>

                    {/* Per-photo next-step / feedback hint */}
                    <div className="absolute bottom-0 left-0 right-0 px-3 py-2 bg-gradient-to-t from-black/80 to-transparent">
                      <UserNextStepPanel status={photoStatus} compact />
                    </div>

                    {/* Hover overlay */}
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                      <Camera className="h-8 w-8 text-white opacity-0 group-hover:opacity-60 transition-opacity" />
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </motion.div>
        ))}

        {entries.length === 0 && (
          <div className="text-center py-12 border border-dashed border-border">
            <ImageIcon className="h-8 w-8 text-muted-foreground/20 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No entries found for this competition.</p>
          </div>
        )}

        {/* Back + View Competition links */}
        <div className="flex items-center gap-4 mt-6 pt-4 border-t border-border">
          <Link to="/dashboard?tab=submissions" className="inline-flex items-center gap-1.5 text-[10px] tracking-[0.15em] uppercase text-muted-foreground hover:text-foreground transition-colors" style={{ fontFamily: "var(--font-heading)" }}>
            <ArrowLeft className="h-3 w-3" /> Back to Submissions
          </Link>
          <Link to={`/competitions/${competitionId}`} className="inline-flex items-center gap-1.5 text-[10px] tracking-[0.15em] uppercase text-primary hover:underline" style={{ fontFamily: "var(--font-heading)" }}>
            <ExternalLink className="h-3 w-3" /> View Competition
          </Link>
        </div>
      </div>

      {/* Lightbox */}
      <AnimatePresence>
        {lightboxOpen && lightboxEntry && (() => {
          const ps = publicStatusMap[lightboxEntry.id];
          return (
            <SubmissionLightbox
              photos={lightboxEntry.photos}
              currentIndex={lightboxIndex}
              entry={lightboxEntry}
              imageReports={lightboxEntry.image_reports}
              onClose={() => setLightboxOpen(false)}
              onNav={setLightboxIndex}
              competitionPhase={comp?.phase}
              competitionCurrentRound={comp?.current_round ?? null}
              scoresReleased={scoresReleased}
              placementReleased={placementReleased}
              publicPlacement={ps?.public_placement ?? null}
              publicStatus={ps?.public_status ?? "judging_in_progress"}
            />
          );
        })()}
      </AnimatePresence>

      {editingEntryId && (
        <EditEntryDialog
          entryId={editingEntryId}
          open={!!editingEntryId}
          onOpenChange={(o) => { if (!o) setEditingEntryId(null); }}
          onSaved={() => setRefreshKey((k) => k + 1)}
        />
      )}
    </main>
  );
};

export default SubmissionDetail;
