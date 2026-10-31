/**
 * SystemTagRequestForm
 * --------------------
 * Admin-facing helper that DRAFTS a migration SQL snippet to add a new
 * `is_system = true` judging tag. It does NOT write to the database — system
 * tags must always go through the supabase migration tool so the change is
 * reviewed, approved, and audit-logged.
 *
 * Flow:
 *   1. Admin fills label + round + intended effect (family).
 *   2. Form validates the label against `classifyTag()` to ensure the
 *      progression engine will recognize it once inserted.
 *   3. On "Generate Draft", the form renders a copyable SQL block + a
 *      checklist of any code changes still required (e.g. extending
 *      tagSemantics.ts for a new label, mapping awards in ParticipantStageBadge).
 *   4. Admin copies the SQL and asks engineering to run it as a migration.
 */

import { useMemo, useState } from "react";
import { Copy, FileCode2, AlertTriangle, CheckCircle2, ShieldAlert } from "lucide-react";
import { toast } from "@/hooks/core/use-toast";
import { classifyTag, type TagFamily } from "@/lib/judging/tagSemantics";

type IntendedEffect =
  | "progression_pass"
  | "progression_fail"
  | "rejection"
  | "verification"
  | "award";

const EFFECT_OPTIONS: { value: IntendedEffect; label: string; help: string }[] = [
  { value: "progression_pass", label: "Progression Pass", help: "Advances the photo to the next round." },
  { value: "progression_fail", label: "Progression Fail", help: "Photo passed current round but is OUT for the next." },
  { value: "rejection", label: "Rejection", help: "Removes the photo from the competition entirely (Round 1 only)." },
  { value: "verification", label: "Verification", help: "Puts the photo on hold pending RAW upload from participant." },
  { value: "award", label: "Award (Round 4)", help: "Confers a final-round honor (Winner, Runner-Up, Special Jury, etc.)." },
];

const ROUND_OPTIONS = [1, 2, 3, 4] as const;

const familyToEffect = (f: TagFamily): IntendedEffect | null =>
  f === "unknown" ? null : (f as IntendedEffect);

const escapeSqlLiteral = (s: string) => s.replace(/'/g, "''");

const SystemTagRequestForm = () => {
  const [label, setLabel] = useState("");
  const [round, setRound] = useState<number>(2);
  const [effect, setEffect] = useState<IntendedEffect>("progression_pass");
  const [color, setColor] = useState("#10b981");
  const [icon, setIcon] = useState("award");
  const [reason, setReason] = useState("");
  const [generated, setGenerated] = useState(false);

  const trimmedLabel = label.trim();

  // Live classification: does the engine already recognize this label?
  const classification = useMemo(() => {
    if (!trimmedLabel) return null;
    return classifyTag({ label: trimmedLabel, visible_in_round: [round] });
  }, [trimmedLabel, round]);

  const detectedEffect = classification ? familyToEffect(classification.family) : null;
  const familyMatchesIntent = detectedEffect === effect;
  const familyIsKnown = classification && classification.family !== "unknown";

  // Build the SQL draft
  const sqlDraft = useMemo(() => {
    if (!trimmedLabel) return "";
    return `-- Request: add system judging tag "${escapeSqlLiteral(trimmedLabel)}"
-- Round: ${round}  |  Intended effect: ${effect}
-- Reason: ${escapeSqlLiteral(reason || "(not provided)")}
--
-- Pre-flight checklist (engineering must verify before running):
--   [ ] classifyTag() in src/lib/judging/tagSemantics.ts returns family = ${effect}
--       for label '${escapeSqlLiteral(trimmedLabel)}'.
${
  effect === "award"
    ? `--   [ ] Lowercased label added to MAPPED_AWARD_LABELS in
--       src/pages/admin/AdminTagSemanticsAudit.tsx.
--   [ ] Placement mapping updated in
--       src/components/judging/ParticipantStageBadge.tsx.\n`
    : ""
}--   [ ] /admin/tag-semantics-audit shows Mapped + correct Effect after insert.

INSERT INTO public.judging_tags
  (label, is_system, is_active, visible_in_round, sort_order, color, icon)
VALUES
  ('${escapeSqlLiteral(trimmedLabel)}', true, true, ARRAY[${round}], 50, '${escapeSqlLiteral(
      color
    )}', '${escapeSqlLiteral(icon)}');`;
  }, [trimmedLabel, round, effect, reason, color, icon]);

  const canGenerate = trimmedLabel.length >= 3 && reason.trim().length >= 10;

  const handleGenerate = () => {
    if (!canGenerate) {
      toast({
        title: "Missing fields",
        description: "Label (≥ 3 chars) and reason (≥ 10 chars) are required.",
        variant: "destructive",
      });
      return;
    }
    setGenerated(true);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(sqlDraft);
      toast({ title: "Migration draft copied to clipboard" });
    } catch {
      toast({ title: "Copy failed", description: "Select the text manually.", variant: "destructive" });
    }
  };

  return (
    <div className="border border-border p-4 space-y-4 bg-muted/20">
      <div className="flex items-start gap-3">
        <FileCode2 className="h-5 w-5 text-primary mt-0.5 shrink-0" />
        <div>
          <h3
            className="text-sm tracking-[0.2em] uppercase text-foreground"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            Request a System Tag
          </h3>
          <p className="text-[11px] text-muted-foreground mt-1 max-w-2xl" style={{ fontFamily: "var(--font-body)" }}>
            System tags drive progression / awards and cannot be created from the UI. Fill this
            form to generate a migration draft; an engineer will review and apply it via the
            migration tool. Nothing is written to the database here.
          </p>
        </div>
      </div>

      {/* Form fields */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="space-y-1">
          <span
            className="text-[9px] tracking-[0.2em] uppercase text-muted-foreground block"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            Exact Label
          </span>
          <input
            type="text"
            value={label}
            onChange={(e) => {
              setLabel(e.target.value);
              setGenerated(false);
            }}
            placeholder='e.g. "Qualified for Round 3"'
            maxLength={100}
            className="w-full bg-transparent border border-border px-2 py-1.5 text-sm outline-none focus:border-primary"
            style={{ fontFamily: "var(--font-body)" }}
          />
        </label>

        <label className="space-y-1">
          <span
            className="text-[9px] tracking-[0.2em] uppercase text-muted-foreground block"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            Round
          </span>
          <div className="flex items-center gap-1.5">
            {ROUND_OPTIONS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => {
                  setRound(r);
                  setGenerated(false);
                }}
                className={`px-2.5 py-1 text-[10px] tracking-[0.1em] uppercase border transition-colors ${
                  round === r
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:border-primary/50"
                }`}
                style={{ fontFamily: "var(--font-heading)" }}
              >
                {round === r ? "● " : "○ "}R{r}
              </button>
            ))}
          </div>
        </label>

        <label className="space-y-1 md:col-span-2">
          <span
            className="text-[9px] tracking-[0.2em] uppercase text-muted-foreground block"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            Intended Effect
          </span>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
            {EFFECT_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  setEffect(opt.value);
                  setGenerated(false);
                }}
                className={`text-left px-2.5 py-1.5 border transition-colors ${
                  effect === opt.value
                    ? "border-primary bg-primary/10"
                    : "border-border hover:border-primary/40"
                }`}
              >
                <span
                  className="block text-[10px] tracking-[0.15em] uppercase"
                  style={{ fontFamily: "var(--font-heading)" }}
                >
                  {effect === opt.value ? "● " : "○ "}
                  {opt.label}
                </span>
                <span className="block text-[10px] text-muted-foreground mt-0.5" style={{ fontFamily: "var(--font-body)" }}>
                  {opt.help}
                </span>
              </button>
            ))}
          </div>
        </label>

        <label className="space-y-1">
          <span
            className="text-[9px] tracking-[0.2em] uppercase text-muted-foreground block"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            Color
          </span>
          <input
            type="color"
            value={color}
            onChange={(e) => {
              setColor(e.target.value);
              setGenerated(false);
            }}
            className="w-12 h-8 cursor-pointer border border-border bg-transparent"
          />
        </label>

        <label className="space-y-1">
          <span
            className="text-[9px] tracking-[0.2em] uppercase text-muted-foreground block"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            Icon Key
          </span>
          <input
            type="text"
            value={icon}
            onChange={(e) => {
              setIcon(e.target.value.replace(/[^a-z0-9_-]/gi, "").toLowerCase());
              setGenerated(false);
            }}
            placeholder="award"
            maxLength={32}
            className="w-full bg-transparent border border-border px-2 py-1.5 text-sm outline-none focus:border-primary"
            style={{ fontFamily: "var(--font-body)" }}
          />
        </label>

        <label className="space-y-1 md:col-span-2">
          <span
            className="text-[9px] tracking-[0.2em] uppercase text-muted-foreground block"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            Reason / Justification (≥ 10 chars)
          </span>
          <textarea
            value={reason}
            onChange={(e) => {
              setReason(e.target.value);
              setGenerated(false);
            }}
            placeholder="Why does this need to be a system tag? Which workflow or rule depends on it?"
            rows={2}
            maxLength={500}
            className="w-full bg-transparent border border-border px-2 py-1.5 text-sm outline-none focus:border-primary resize-none"
            style={{ fontFamily: "var(--font-body)" }}
          />
        </label>
      </div>

      {/* Live classifier feedback */}
      {trimmedLabel && classification && (
        <div
          className={`flex items-start gap-2 px-3 py-2 border text-[11px] ${
            !familyIsKnown
              ? "border-destructive/40 bg-destructive/5 text-destructive"
              : familyMatchesIntent
              ? "border-primary/40 bg-primary/5 text-primary"
              : "border-amber-500/40 bg-amber-500/5 text-amber-600 dark:text-amber-400"
          }`}
          style={{ fontFamily: "var(--font-body)" }}
        >
          {!familyIsKnown ? (
            <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
          ) : familyMatchesIntent ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
          ) : (
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          )}
          <div className="space-y-0.5">
            <div className="font-medium">
              Classifier says: <span className="font-mono">{classification.family}</span>
            </div>
            <div className="opacity-80">{classification.explanation}</div>
            {!familyIsKnown && (
              <div className="opacity-90 mt-1">
                ⚠ The engine will treat this label as a no-op until{" "}
                <span className="font-mono">src/lib/judging/tagSemantics.ts</span> is extended to
                recognize it. The migration draft below includes that step in its checklist.
              </div>
            )}
            {familyIsKnown && !familyMatchesIntent && (
              <div className="opacity-90 mt-1">
                ⚠ Mismatch: you selected <span className="font-mono">{effect}</span> but the
                classifier returns <span className="font-mono">{classification.family}</span>. Pick
                a different label, change the intended effect, or update the classifier.
              </div>
            )}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleGenerate}
          disabled={!canGenerate}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground text-[10px] tracking-[0.15em] uppercase hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          <FileCode2 className="h-3 w-3" />
          Generate Migration Draft
        </button>
      </div>

      {/* Generated SQL preview */}
      {generated && sqlDraft && (
        <div className="border border-border bg-background">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border">
            <span
              className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              Migration Draft (SQL)
            </span>
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex items-center gap-1.5 px-2 py-1 border border-border text-[10px] tracking-[0.1em] uppercase hover:border-primary hover:text-primary transition-colors"
              style={{ fontFamily: "var(--font-heading)" }}
            >
              <Copy className="h-3 w-3" /> Copy
            </button>
          </div>
          <pre
            className="p-3 text-[11px] leading-relaxed overflow-x-auto whitespace-pre-wrap break-words text-foreground/90"
            style={{ fontFamily: "ui-monospace, SFMono-Regular, monospace" }}
          >
            {sqlDraft}
          </pre>
          <div
            className="px-3 py-2 border-t border-border text-[10px] text-muted-foreground"
            style={{ fontFamily: "var(--font-body)" }}
          >
            Send this draft to engineering. They will review the checklist, extend the classifier
            if needed, then apply it via the migration tool. The form does not write to the
            database.
          </div>
        </div>
      )}
    </div>
  );
};

export default SystemTagRequestForm;
