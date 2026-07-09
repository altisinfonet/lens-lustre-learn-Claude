/**
 * JudgeUIvsDBGateAudit
 * --------------------
 * Admin forensic widget that, for a given (competition, round), lists every
 * entry side-by-side with:
 *
 *   - JUDGE UI side  → the per-photo eligible set the judge panel actually
 *     loads (R1: every uploaded photo; R2+: get_round_eligible_photos),
 *
 *   - DB GATE side   → exactly what supabase/functions/complete-round (lock)
 *     and supabase/functions/publish-round (declare) require before allowing
 *     the round to advance:
 *        • assigned judges (distributed-mode aware),
 *        • expected vs missing per-(judge,photo) decisions,
 *        • missing 10-criteria score coverage (R2/R3/R4),
 *        • pending photo verifications (R4 only).
 *
 * Mismatched entries float to the top with a red badge so blockers jump out.
 *
 * Backed by SECURITY DEFINER RPC `public.get_round_judging_gate_admin`,
 * which is gated to `admin` role server-side. Read-only.
 */
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  ShieldCheck,
  ScanSearch,
  Lock,
  Eye,
} from "lucide-react";

interface SamplePhoto {
  judge_id: string;
  photo_index: number;
}

interface GateRow {
  competition_id: string;
  round_number: number;
  entry_id: string;
  entry_title: string | null;
  entry_status: string | null;
  total_photos: number;
  ui_eligible_photos: number;
  ui_eligible_photo_indices: number[];
  assigned_judges: number;
  expected_decisions: number;
  present_decisions: number;
  missing_decisions: number;
  missing_decision_sample: SamplePhoto[];
  expected_scores: number;
  missing_scores: number;
  missing_score_sample: SamplePhoto[];
  verification_pending: boolean;
  ready_to_lock: boolean;
}

interface CompetitionOption {
  id: string;
  title: string;
  status: string | null;
  current_round: string | null;
}

const inputCls =
  "w-full bg-secondary-foreground border border-border/50 px-2 py-1.5 text-[11px] text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-primary/60";
const labelCls =
  "block text-[9px] tracking-[0.15em] uppercase text-muted-foreground/70 mb-1";

const ROUND_LABEL: Record<number, string> = {
  1: "R1 — Initial Screening",
  2: "R2 — Shortlist",
  3: "R3 — Finalist Selection",
  4: "R4 — Final Awards",
};

const JudgeUIvsDBGateAudit = () => {
  const [competitions, setCompetitions] = useState<CompetitionOption[]>([]);
  const [competitionId, setCompetitionId] = useState("");
  const [round, setRound] = useState<number>(1);
  const [rows, setRows] = useState<GateRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  // Load active competitions for the picker. Falls back to a free-text uuid
  // input below if the list is empty / the desired comp isn't shown.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error: e } = await supabase
        .from("competitions")
        .select("id, title, status, current_round")
        .order("updated_at", { ascending: false })
        .limit(50);
      if (!cancelled) {
        if (e) {
          // Non-fatal — admin can still type a uuid manually.
          console.warn("[JudgeUIvsDBGate] competitions list failed:", e.message);
        } else {
          setCompetitions((data || []) as CompetitionOption[]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const run = async () => {
    setLoading(true);
    setError(null);
    setRows(null);
    setExpanded(null);
    try {
      if (!competitionId) throw new Error("Pick a competition (or paste its UUID).");
      if (round < 1 || round > 4) throw new Error("Round must be 1–4.");
      const { data, error: rpcErr } = await supabase.rpc(
        "get_round_judging_gate_admin" as any,
        { _competition_id: competitionId, _round_number: round },
      );
      if (rpcErr) throw rpcErr;
      setRows((data as GateRow[]) || []);
    } catch (e: any) {
      setError(e?.message ?? "Failed to run gate audit");
    } finally {
      setLoading(false);
    }
  };

  const summary = useMemo(() => {
    if (!rows) return null;
    const total = rows.length;
    const ready = rows.filter((r) => r.ready_to_lock).length;
    const blockedDecisions = rows.filter((r) => r.missing_decisions > 0).length;
    const blockedScores = rows.filter((r) => r.missing_scores > 0).length;
    const blockedVerif = rows.filter((r) => r.verification_pending).length;
    const noEligible = rows.filter((r) => r.ui_eligible_photos === 0).length;
    return { total, ready, blockedDecisions, blockedScores, blockedVerif, noEligible };
  }, [rows]);

  return (
    <div className="border-2 border-primary/40 rounded-lg p-5 bg-primary/5">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h3
          className="text-sm font-semibold text-foreground flex items-center gap-2"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          <ScanSearch className="h-3.5 w-3.5 text-primary" />
          Judge UI vs DB Gate — per-entry coverage audit
        </h3>
        <button
          onClick={run}
          disabled={loading}
          className="inline-flex items-center gap-1.5 text-[10px] tracking-[0.1em] uppercase px-3 py-1.5 bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
          {loading ? "Scanning…" : "Run Audit"}
        </button>
      </div>

      <p
        className="text-[10px] text-muted-foreground/80 mb-3 max-w-3xl leading-relaxed"
        style={{ fontFamily: "var(--font-body)" }}
      >
        Compares what the judge panel <em>shows</em> as eligible photos against
        what the DB gate (<code>complete-round</code> for locking,{" "}
        <code>publish-round</code> for declaring) <em>requires</em>. Any entry
        with a non-zero <strong>Missing</strong> column blocks the round from
        being locked or declared. R4 also surfaces pending photo verifications.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
        <div>
          <label className={labelCls} style={{ fontFamily: "var(--font-heading)" }}>
            Competition
          </label>
          <select
            value={competitionId}
            onChange={(e) => setCompetitionId(e.target.value)}
            className={inputCls}
          >
            <option value="">— pick a competition —</option>
            {competitions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
                {c.status ? ` · ${c.status}` : ""}
                {c.current_round ? ` · r${c.current_round}` : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelCls} style={{ fontFamily: "var(--font-heading)" }}>
            …or paste competition UUID
          </label>
          <input
            value={competitionId}
            onChange={(e) => setCompetitionId(e.target.value.trim())}
            placeholder="00000000-0000-0000-0000-000000000000"
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls} style={{ fontFamily: "var(--font-heading)" }}>
            Round
          </label>
          <select
            value={round}
            onChange={(e) => setRound(parseInt(e.target.value, 10))}
            className={inputCls}
          >
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {ROUND_LABEL[n]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && (
        <div className="border border-destructive/30 bg-destructive/5 p-2 mb-3">
          <p className="text-[10px] text-destructive flex items-center gap-1.5">
            <AlertTriangle className="h-3 w-3" /> {error}
          </p>
        </div>
      )}

      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-3">
          <SummaryStat label="Entries" value={summary.total} />
          <SummaryStat label="Ready" value={summary.ready} tone="ok" />
          <SummaryStat
            label="Missing decisions"
            value={summary.blockedDecisions}
            tone={summary.blockedDecisions ? "bad" : "ok"}
          />
          <SummaryStat
            label="Missing scores"
            value={summary.blockedScores}
            tone={summary.blockedScores ? "bad" : "ok"}
            hint={round === 1 ? "n/a in R1" : undefined}
          />
          <SummaryStat
            label="Verif pending"
            value={summary.blockedVerif}
            tone={summary.blockedVerif ? "bad" : "ok"}
            hint={round !== 4 ? "R4 only" : undefined}
          />
        </div>
      )}

      {rows && rows.length === 0 && (
        <div className="border border-border/40 p-3 text-[11px] text-muted-foreground">
          No entries found for this competition.
        </div>
      )}

      {rows && rows.length > 0 && (
        <div className="border border-border/40 overflow-x-auto">
          <table className="w-full text-[10px]">
            <thead>
              <tr
                className="border-b border-border/40 bg-card/40 text-muted-foreground/80"
                style={{ fontFamily: "var(--font-heading)" }}
              >
                <Th>Entry</Th>
                <Th align="right">Photos</Th>
                <Th align="right">UI eligible</Th>
                <Th align="right">Judges</Th>
                <Th align="right">Decisions exp / got</Th>
                <Th align="right">Missing dec.</Th>
                <Th align="right">Missing scores</Th>
                <Th align="right">Verif</Th>
                <Th align="right">Status</Th>
                <Th align="right">{"\u00A0"}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const isExpanded = expanded === r.entry_id;
                const blocked = !r.ready_to_lock;
                return (
                  <FragmentRow
                    key={r.entry_id}
                    row={r}
                    blocked={blocked}
                    expanded={isExpanded}
                    onToggle={() =>
                      setExpanded(isExpanded ? null : r.entry_id)
                    }
                    round={round}
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {rows && summary && summary.ready === summary.total && summary.total > 0 && (
        <div
          className="mt-3 flex items-center gap-2 text-[10px] tracking-[0.1em] uppercase text-green-500"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          <ShieldCheck className="h-3 w-3" />
          All entries pass the {ROUND_LABEL[round]} gate · safe to{" "}
          {round === 4 ? "lock & declare" : "lock"}.
        </div>
      )}
    </div>
  );
};

// ── Sub-components ─────────────────────────────────────────────────────────

const Th = ({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) => (
  <th
    className={`px-2 py-1.5 text-[9px] tracking-[0.15em] uppercase font-semibold ${
      align === "right" ? "text-right" : "text-left"
    }`}
  >
    {children}
  </th>
);

const Td = ({
  children,
  align = "left",
  tone,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  tone?: "ok" | "bad" | "muted";
}) => (
  <td
    className={`px-2 py-1.5 tabular-nums ${
      align === "right" ? "text-right" : "text-left"
    } ${
      tone === "ok"
        ? "text-green-500"
        : tone === "bad"
          ? "text-destructive font-semibold"
          : tone === "muted"
            ? "text-muted-foreground/60"
            : "text-foreground"
    }`}
  >
    {children}
  </td>
);

const SummaryStat = ({
  label,
  value,
  tone = "default",
  hint,
}: {
  label: string;
  value: number;
  tone?: "default" | "ok" | "bad";
  hint?: string;
}) => (
  <div
    className={`border px-2 py-1.5 ${
      tone === "ok"
        ? "border-green-500/30 bg-green-500/5"
        : tone === "bad"
          ? "border-destructive/30 bg-destructive/5"
          : "border-border/40 bg-card/40"
    }`}
  >
    <div
      className="text-[8px] tracking-[0.15em] uppercase text-muted-foreground/70 flex items-center justify-between gap-2"
      style={{ fontFamily: "var(--font-heading)" }}
    >
      <span>{label}</span>
      {hint && (
        <span className="text-[7px] text-muted-foreground/40 normal-case tracking-normal">
          {hint}
        </span>
      )}
    </div>
    <div className="text-foreground tabular-nums font-semibold text-sm">
      {value}
    </div>
  </div>
);

const FragmentRow = ({
  row,
  blocked,
  expanded,
  onToggle,
  round,
}: {
  row: GateRow;
  blocked: boolean;
  expanded: boolean;
  onToggle: () => void;
  round: number;
}) => {
  const sampleDec = Array.isArray(row.missing_decision_sample)
    ? row.missing_decision_sample
    : [];
  const sampleScore = Array.isArray(row.missing_score_sample)
    ? row.missing_score_sample
    : [];
  const showExpander =
    sampleDec.length > 0 ||
    sampleScore.length > 0 ||
    (row.ui_eligible_photo_indices?.length ?? 0) > 0;

  return (
    <>
      <tr
        className={`border-b border-border/30 ${
          blocked ? "bg-destructive/5" : "hover:bg-card/40"
        }`}
      >
        <td className="px-2 py-1.5 max-w-[260px]">
          <div className="text-foreground truncate" title={row.entry_title ?? row.entry_id}>
            {row.entry_title || <span className="text-muted-foreground/60">(untitled)</span>}
          </div>
          <div className="text-[9px] text-muted-foreground/50 font-mono truncate">
            {row.entry_id}
          </div>
        </td>
        <Td align="right">{row.total_photos}</Td>
        <Td
          align="right"
          tone={row.ui_eligible_photos === 0 ? "muted" : undefined}
        >
          {row.ui_eligible_photos}
        </Td>
        <Td align="right">{row.assigned_judges}</Td>
        <Td align="right">
          {row.expected_decisions} / {row.present_decisions}
        </Td>
        <Td align="right" tone={row.missing_decisions > 0 ? "bad" : "ok"}>
          {row.missing_decisions}
        </Td>
        <Td
          align="right"
          tone={
            round === 1
              ? "muted"
              : row.missing_scores > 0
                ? "bad"
                : "ok"
          }
        >
          {round === 1 ? "—" : row.missing_scores}
        </Td>
        <Td
          align="right"
          tone={
            round !== 4
              ? "muted"
              : row.verification_pending
                ? "bad"
                : "ok"
          }
        >
          {round !== 4 ? "—" : row.verification_pending ? "pending" : "ok"}
        </Td>
        <Td align="right">
          {row.ready_to_lock ? (
            <span className="inline-flex items-center gap-1 text-green-500">
              <CheckCircle2 className="h-3 w-3" /> Ready
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-destructive">
              <Lock className="h-3 w-3" /> Blocked
            </span>
          )}
        </Td>
        <td className="px-2 py-1.5 text-right">
          {showExpander && (
            <button
              onClick={onToggle}
              className="inline-flex items-center gap-1 text-[9px] tracking-[0.1em] uppercase text-muted-foreground hover:text-foreground"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              <Eye className="h-3 w-3" /> {expanded ? "hide" : "details"}
            </button>
          )}
        </td>
      </tr>
      {expanded && (
        <tr className="bg-card/30 border-b border-border/30">
          <td colSpan={10} className="px-3 py-2">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <DetailBox title="UI eligible photo indices">
                {row.ui_eligible_photo_indices.length === 0 ? (
                  <span className="text-muted-foreground/60">none</span>
                ) : (
                  <span className="font-mono">
                    {row.ui_eligible_photo_indices.join(", ")}
                  </span>
                )}
              </DetailBox>
              <DetailBox
                title={`Missing decisions (sample, up to 20 of ${row.missing_decisions})`}
                tone={row.missing_decisions > 0 ? "bad" : "ok"}
              >
                {sampleDec.length === 0 ? (
                  <span className="text-muted-foreground/60">none</span>
                ) : (
                  <ul className="space-y-0.5 font-mono">
                    {sampleDec.map((s, i) => (
                      <li key={i}>
                        judge <span className="opacity-70">{short(s.judge_id)}</span>{" "}
                        · #{s.photo_index}
                      </li>
                    ))}
                  </ul>
                )}
              </DetailBox>
              <DetailBox
                title={`Missing scores (sample, up to 20 of ${row.missing_scores})`}
                tone={row.missing_scores > 0 ? "bad" : "ok"}
              >
                {round === 1 ? (
                  <span className="text-muted-foreground/60">
                    R1 has no 10-criteria gate.
                  </span>
                ) : sampleScore.length === 0 ? (
                  <span className="text-muted-foreground/60">none</span>
                ) : (
                  <ul className="space-y-0.5 font-mono">
                    {sampleScore.map((s, i) => (
                      <li key={i}>
                        judge <span className="opacity-70">{short(s.judge_id)}</span>{" "}
                        · #{s.photo_index}
                      </li>
                    ))}
                  </ul>
                )}
              </DetailBox>
            </div>
          </td>
        </tr>
      )}
    </>
  );
};

const DetailBox = ({
  title,
  tone,
  children,
}: {
  title: string;
  tone?: "ok" | "bad";
  children: React.ReactNode;
}) => (
  <div
    className={`border p-2 text-[10px] ${
      tone === "bad"
        ? "border-destructive/30 bg-destructive/5"
        : "border-border/40 bg-card/40"
    }`}
  >
    <div
      className="text-[8px] tracking-[0.15em] uppercase text-muted-foreground/70 mb-1"
      style={{ fontFamily: "var(--font-heading)" }}
    >
      {title}
    </div>
    <div className="text-foreground max-h-40 overflow-auto">{children}</div>
  </div>
);

const short = (uuid: string) =>
  uuid && uuid.length >= 8 ? `${uuid.slice(0, 4)}…${uuid.slice(-4)}` : uuid;

export default JudgeUIvsDBGateAudit;
