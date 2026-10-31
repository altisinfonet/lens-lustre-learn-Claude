import { memo, useState } from "react";
import {
  X, MousePointerClick, Sparkles, Award, Keyboard,
  CheckCircle2, AlertCircle, Lock, Trophy,
} from "lucide-react";

/**
 * Judging v6 — Spec v3 (approved 2026-04-25)
 * ---------------------------------------------------------------
 * Golden Rules taught here:
 *   1. Locking ≠ Declaring. Judge "Complete Round" = LOCK; Admin "Declare" = PUBLISH.
 *   2. Marks are PRIVATE. Participants only ever see status.
 *   3. Tags are R4-ONLY. R1/R2/R3 have no tag chips.
 *   4. R2/R3/R4 require ALL 10 SOW criteria before a photo's score is final;
 *      the tier is auto-derived from the average (0 → Needs Review,
 *      1–6.9 → Qualified-this-round, 7–10 → next round / award-eligible).
 *   5. R4 only Winner is mandatory; Runner-Ups, Honorary Mention, Special
 *      Jury Award are optional.
 */

interface JudgeGuideModalProps {
  open: boolean;
  onClose: () => void;
}

const f = { fontFamily: "var(--font-heading)" };
const fd = { fontFamily: "var(--font-display)" };

const tabs = [
  { id: "r1", label: "Round 1", icon: MousePointerClick },
  { id: "r2r3", label: "Rounds 2-3", icon: Sparkles },
  { id: "r4", label: "Round 4", icon: Trophy },
  { id: "hotkeys", label: "Hotkeys", icon: Keyboard },
] as const;

type TabId = (typeof tabs)[number]["id"];

/* ── Round 1 Tab ── */
const R1Guide = () => (
  <div className="space-y-4">
    <p className="text-sm text-muted-foreground leading-relaxed" style={f}>
      Round 1 is a fast <strong className="text-foreground">decision-only</strong> screening.
      For each photo, click <em>one</em> of four buttons. There are no sliders, no comments,
      and <strong className="text-foreground">no tags</strong> in this round.
    </p>
    <div className="grid gap-2">
      {[
        { label: "Accept", desc: "Photo is technically and creatively sound. Stays in the competition without being shortlisted." },
        { label: "Shortlist for R2", desc: "Photo deserves the next round of detailed scoring." },
        { label: "Needs Review", desc: "You're undecided — flags the photo for a second pass before lock." },
        { label: "Reject", desc: "Photo is out of the competition." },
      ].map((s) => (
        <div key={s.label} className="flex items-start gap-3 rounded-lg border border-border/40 bg-card/50 px-3 py-2">
          <MousePointerClick className="w-4 h-4 text-primary shrink-0 mt-0.5" />
          <div>
            <span className="text-[13px] font-semibold text-foreground" style={f}>{s.label}</span>
            <p className="text-[11px] text-muted-foreground/70 leading-snug" style={f}>{s.desc}</p>
          </div>
        </div>
      ))}
    </div>
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5">
      <p className="text-xs text-muted-foreground leading-relaxed" style={f}>
        <strong className="text-amber-500">No tags in R1.</strong> Tag chips only appear in Round 4.
        Your decision here is recorded directly via the four buttons.
      </p>
    </div>
  </div>
);

/* ── Rounds 2-3 Tab ── */
const R2R3Guide = () => (
  <div className="space-y-4">
    <p className="text-sm text-muted-foreground leading-relaxed" style={f}>
      Rounds 2 and 3 are <strong className="text-foreground">mandatory 10-criteria scoring</strong>.
      You must rate every photo on all ten SOW criteria before the round can be locked.
    </p>
    <div className="grid grid-cols-2 gap-2">
      {["LINE", "SHAPE", "FORM", "TEXTURE", "COLOR", "SPACE", "TONE", "BALANCE", "LIGHT", "DEPTH"].map((c) => (
        <div key={c} className="flex items-center gap-2 rounded-lg border border-border/40 bg-card/50 px-3 py-2">
          <span className="w-1.5 h-1.5 rounded-full bg-primary" />
          <span className="text-[12px] font-semibold text-foreground tracking-wider" style={f}>{c}</span>
        </div>
      ))}
    </div>
    <div className="grid gap-2">
      {[
        { icon: CheckCircle2, color: "text-emerald-500", title: "Auto-tier from average", desc: "Once all 10 criteria are set, the system computes the average and assigns the tier automatically: 0 → Needs Review, 1–6.9 → Qualified this round, 7–10 → next round." },
        { icon: AlertCircle, color: "text-amber-500", title: "All 10 are required", desc: "The criteria header shows 'X of 10'. The round cannot be locked until every assigned judge has filled all 10 criteria for every eligible photo." },
        { icon: Lock, color: "text-primary", title: "Marks are private", desc: "Participants never see your scores or feedback. They only see the resulting status when the admin declares the round." },
      ].map((s) => (
        <div key={s.title} className="flex items-start gap-3 rounded-lg border border-border/40 bg-card/50 px-3 py-2.5">
          <s.icon className={`w-5 h-5 ${s.color} shrink-0 mt-0.5`} />
          <div>
            <span className="text-[13px] font-semibold text-foreground" style={f}>{s.title}</span>
            <p className="text-[11px] text-muted-foreground/70 leading-snug" style={f}>{s.desc}</p>
          </div>
        </div>
      ))}
    </div>
  </div>
);

/* ── Round 4 Tab ── */
const R4Guide = () => (
  <div className="space-y-4">
    <p className="text-sm text-muted-foreground leading-relaxed" style={f}>
      Round 4 is the final. You score the same 10 criteria <em>and</em> assign award tags.
      <strong className="text-foreground"> Tags only appear in Round 4.</strong>
    </p>
    <div className="grid gap-2">
      {[
        { label: "Winner — mandatory", desc: "Exactly one Winner must be assigned before the round can close.", color: "text-emerald-500" },
        { label: "1st Runner-Up — optional", desc: "Optional. If assigned, must be unique.", color: "text-muted-foreground" },
        { label: "2nd Runner-Up — optional", desc: "Optional. If assigned, must be unique.", color: "text-muted-foreground" },
        { label: "Honorary Mention — optional", desc: "Recognition only. May be assigned to multiple entries.", color: "text-muted-foreground" },
        { label: "Special Jury Award — optional", desc: "Recognition only. May be assigned to multiple entries.", color: "text-muted-foreground" },
      ].map((s) => (
        <div key={s.label} className="flex items-start gap-3 rounded-lg border border-border/40 bg-card/50 px-3 py-2.5">
          <Award className={`w-4 h-4 ${s.color} shrink-0 mt-0.5`} />
          <div>
            <span className="text-[13px] font-semibold text-foreground" style={f}>{s.label}</span>
            <p className="text-[11px] text-muted-foreground/70 leading-snug" style={f}>{s.desc}</p>
          </div>
        </div>
      ))}
    </div>
    <div className="rounded-lg border border-border/40 bg-muted/10 px-3 py-2.5">
      <p className="text-xs text-muted-foreground leading-relaxed" style={f}>
        <strong className="text-foreground">Locking ≠ Declaring.</strong> When you complete the round
        the results are <em>locked</em> but still hidden from participants. The Admin must explicitly
        <em> Declare</em> the round to publish results, send certificates and notify participants.
      </p>
    </div>
  </div>
);

/* ── Hotkeys Tab ── */
const HotkeysGuide = () => (
  <div className="space-y-4">
    <p className="text-sm text-muted-foreground leading-relaxed" style={f}>
      Speed up your workflow. Hotkeys are disabled while typing in text fields (notes, comments, search).
    </p>
    <div className="grid grid-cols-2 gap-2">
      {[
        { keys: "← →", action: "Previous / Next photo" },
        { keys: "+ / −", action: "Zoom in / out" },
        { keys: "F", action: "Toggle full view" },
        { keys: "Esc", action: "Exit full view / close dialogs" },
        { keys: "G", action: "Open this guide" },
      ].map((hk) => (
        <div key={hk.keys} className="flex items-center gap-2.5 rounded-lg border border-border/40 bg-card/50 px-3 py-2">
          <kbd className="px-2 py-0.5 rounded bg-muted text-[11px] font-mono font-bold text-foreground border border-border/60 shrink-0">
            {hk.keys}
          </kbd>
          <span className="text-[12px] text-muted-foreground" style={f}>{hk.action}</span>
        </div>
      ))}
    </div>
    <div className="rounded-lg border border-border/40 bg-muted/10 px-3 py-2.5">
      <p className="text-xs text-muted-foreground leading-relaxed" style={f}>
        <strong className="text-foreground">Note:</strong> direct numeric score shortcuts are disabled
        to prevent accidental marks — set scores via the sliders or the per-criterion input box.
      </p>
    </div>
  </div>
);

const tabContent: Record<TabId, React.FC> = {
  r1: R1Guide,
  r2r3: R2R3Guide,
  r4: R4Guide,
  hotkeys: HotkeysGuide,
};

const JudgeGuideModal = memo(({ open, onClose }: JudgeGuideModalProps) => {
  const [activeTab, setActiveTab] = useState<TabId>("r1");
  const Content = tabContent[activeTab];

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 animate-in fade-in duration-200"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="relative w-full max-w-[560px] max-h-[85vh] rounded-2xl border border-border/60 bg-background shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 slide-in-from-bottom-2 fade-in duration-200"
      >
          {/* Header */}
          <div className="px-6 pt-5 pb-4 border-b border-border/40">
            <div className="flex items-center justify-between mb-1">
              <h2 className="text-[22px] font-bold text-foreground tracking-tight" style={fd}>
                Judge's Guide · v6
              </h2>
              <button
                onClick={onClose}
                className="w-8 h-8 rounded-lg bg-muted/20 hover:bg-muted/40 flex items-center justify-center transition-colors"
                aria-label="Close guide"
              >
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>
            <p className="text-[13px] text-muted-foreground/60 leading-relaxed" style={f}>
              Spec v3 — R1 decisions, R2/R3 mandatory 10 criteria, R4 awards & tags. Reopen anytime from the toolbar.
            </p>

            <div className="flex gap-1 mt-4">
              {tabs.map((tab) => {
                const active = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all ${
                      active
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted/20 text-muted-foreground hover:bg-muted/40"
                    }`}
                    style={f}
                  >
                    <tab.icon className="w-3.5 h-3.5" />
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-6 py-4 scrollbar-hide">
            <Content />
          </div>

          {/* Footer */}
          <div className="px-6 py-3 border-t border-border/40 flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground/40" style={f}>
              Shown once on first visit
            </span>
            <button
              onClick={onClose}
              className="px-5 py-2 rounded-xl bg-foreground text-background text-[13px] font-bold hover:opacity-90 transition-all"
              style={f}
            >
              Start Judging
            </button>
          </div>
      </div>
    </div>
  );
});
JudgeGuideModal.displayName = "JudgeGuideModal";

export default JudgeGuideModal;
