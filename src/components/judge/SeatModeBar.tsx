/**
 * MASTER-KEY Seat Mode Bar — admin only.
 *
 * Lets an admin "sit in a judge's seat": pick any judge assigned to the current
 * competition and view + edit that judge's exact panel. While seated, every
 * mark saves under the seat judge's name. A loud banner makes the mode
 * unmistakable so an admin can never forget they are writing as someone else.
 *
 * Rendered for admins only. A non-admin never sees this and can never seat
 * (the parent also hard-gates seatJudgeId behind isAdmin).
 */
import { memo } from "react";
import { KeyRound, X, ChevronDown, Eye } from "lucide-react";
import { useT } from "@/i18n/I18nContext";

export interface SeatRosterEntry {
  judgeId: string;
  judgeName: string;
  judgeAvatar?: string | null;
}

interface SeatModeBarProps {
  isAdmin: boolean;
  roster: SeatRosterEntry[];
  seatJudgeId: string | null;
  onSeat: (judgeId: string | null) => void;
  /** Present so the picker can hide the admin's own row (admin is not a "seat"). */
  selfUserId?: string;
}

const SeatModeBar = memo(({ isAdmin, roster, seatJudgeId, onSeat, selfUserId }: SeatModeBarProps) => {
  const t = useT();
  if (!isAdmin) return null;

  const pickable = roster.filter((r) => r.judgeId !== selfUserId);
  const seated = seatJudgeId ? roster.find((r) => r.judgeId === seatJudgeId) : null;

  // No judges to sit as → nothing to show (keeps the panel clean).
  if (pickable.length === 0 && !seated) return null;

  if (seated) {
    return (
      <div className="w-full bg-amber-500/15 border-b border-amber-500/40 px-4 py-2 flex items-center gap-3">
        <KeyRound className="h-4 w-4 text-amber-500 shrink-0" />
        <div className="flex-1 min-w-0 text-xs" style={{ fontFamily: "var(--font-body)" }}>
          <span className="font-semibold text-amber-600 dark:text-amber-400">MASTER KEY — </span>
          <span className="text-foreground">seated as </span>
          <span className="font-semibold text-foreground">{seated.judgeName}</span>
          <span className="text-muted-foreground"> · every mark you make saves under {seated.judgeName}'s name.</span>
        </div>
        <button
          onClick={() => onSeat(null)}
          className="shrink-0 flex items-center gap-1 text-[10px] tracking-[0.1em] uppercase px-2.5 py-1 rounded-sm bg-amber-500/20 hover:bg-amber-500/30 text-amber-700 dark:text-amber-300 border border-amber-500/40 transition-colors"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          <X className="h-3 w-3" /> Exit seat
        </button>
      </div>
    );
  }

  return (
    <div className="w-full bg-muted/30 border-b border-border px-4 py-1.5 flex items-center gap-2">
      <Eye className="h-3.5 w-3.5 text-muted-foreground/70 shrink-0" />
      <span className="text-[10px] tracking-[0.15em] uppercase text-muted-foreground/70 shrink-0" style={{ fontFamily: "var(--font-heading)" }}>
        {t("jg.viewAsJudge")}
      </span>
      <div className="relative">
        <select
          value=""
          onChange={(e) => { if (e.target.value) onSeat(e.target.value); }}
          className="appearance-none text-xs bg-background border border-border rounded-sm pl-2.5 pr-7 py-1 text-foreground focus:outline-none focus:border-primary cursor-pointer"
          style={{ fontFamily: "var(--font-body)" }}
        >
          <option value="">Select a judge…</option>
          {pickable.map((r) => (
            <option key={r.judgeId} value={r.judgeId}>{r.judgeName}</option>
          ))}
        </select>
        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/60 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
      </div>
    </div>
  );
});

SeatModeBar.displayName = "SeatModeBar";
export default SeatModeBar;
