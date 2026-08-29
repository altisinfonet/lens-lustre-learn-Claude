import { useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { REACTIONS } from "@/components/ReactionPicker";
import { supabase } from "@/integrations/supabase/client";
import { fetchProfileMap } from "@/lib/profileMapCache";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Loader2 } from "lucide-react";
import ReactorFriendAction from "@/components/ReactorFriendAction";
import AutoBadge from "@/components/AutoBadge";
import AutoRole from "@/components/AutoRole";
import UserIdentityBlock from "@/components/UserIdentityBlock";

/**
 * WHICH TABLE THE NAMES COME FROM.
 *
 * This panel used to take a bare `postId` and read post_reactions, so a
 * sponsored ad — whose reactions live in ad_creative_reactions — had no way to
 * open it at all. The ad card therefore drew a like count that named nobody,
 * which is what the owner reported on 2026-08-28: *"Reactions name of the
 * person like Feed right side not showing"*.
 *
 * A discriminated union rather than two optional ids: exactly one of them is
 * always right, and the compiler says so at every call site. The two tables
 * carry the SAME columns (user_id, reaction_type) — 20260811120000 mirrored
 * post_reactions deliberately — so only the table and the key column differ.
 */
export type ReactionSource =
  | { kind: "post"; postId: string }
  | { kind: "ad"; creativeId: string };

const sourceTable = (source: ReactionSource) =>
  source.kind === "post"
    ? { table: "post_reactions", column: "post_id", id: source.postId }
    : { table: "ad_creative_reactions", column: "creative_id", id: source.creativeId };

interface ReactionSummaryTooltipProps {
  reactionCounts: Record<string, number>;
  totalCount: number;
  source: ReactionSource;
  children: React.ReactNode;
}

interface ReactorUser {
  user_id: string;
  reaction_type: string;
  full_name: string | null;
  avatar_url: string | null;
}

const ReactionSummaryTooltip = ({ reactionCounts, totalCount, source, children }: ReactionSummaryTooltipProps) => {
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<string>("all");
  const [reactors, setReactors] = useState<ReactorUser[]>([]);
  const [loading, setLoading] = useState(false);

  const breakdown = Object.entries(reactionCounts)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => {
      const reaction = REACTIONS.find(r => r.type === type);
      return reaction ? { type, emoji: reaction.emoji, label: reaction.label, count } : null;
    })
    .filter(Boolean) as { type: string; emoji: string; label: string; count: number }[];

  const fetchReactors = useCallback(async () => {
    setLoading(true);
    const { table, column, id } = sourceTable(source);
    /**
     * TYPED AS post_reactions, WHICHEVER TABLE IT IS.
     *
     * A table name chosen at runtime cannot resolve the generated row types,
     * and ad_creative_reactions is not in them at all. Both really do carry
     * `user_id` and `reaction_type` — 20260811120000 mirrored post_reactions
     * on purpose, and src/__tests__/adEngagement.test.ts holds it to that — so
     * the post row type describes either. Narrowed through `unknown` rather
     * than `any`, so nothing downstream quietly loses its type.
     */
    const { data } = await supabase
      .from(table as unknown as "post_reactions")
      .select("user_id, reaction_type")
      .eq(column as unknown as "post_id", id);

    const rows = (data as unknown as { user_id: string; reaction_type: string }[] | null) ?? [];
    if (rows.length > 0) {
      const userIds = [...new Set(rows.map(r => r.user_id))];
      const profileMap = await fetchProfileMap(userIds);

      // Badges/roles now come from unified profileMap cache

      setReactors(
        rows.map(r => ({
          user_id: r.user_id,
          reaction_type: r.reaction_type,
          full_name: profileMap.get(r.user_id)?.full_name || "Unknown",
          avatar_url: profileMap.get(r.user_id)?.avatar_url || null,
        }))
      );
    } else {
      setReactors([]);
    }
    setLoading(false);
  }, [source]);

  const handleOpen = () => {
    if (totalCount === 0) return;
    setOpen(true);
    setActiveTab("all");
    fetchReactors();
  };

  const filtered = activeTab === "all"
    ? reactors
    : reactors.filter(r => r.reaction_type === activeTab);

  if (totalCount === 0) return <>{children}</>;

  return (
    <>
      {/* Hover tooltip for quick summary */}
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          {/*
            ⚠ A REAL BUTTON, NOT A CLICKABLE DIV. (Fixed 2026-08-28.)

            This was `<div onClick={handleOpen} className="cursor-pointer">`:
            no role, no tabindex, no accessible name. The Reactions dialog — the
            only place the app names WHO reacted — could be opened with a mouse
            and by no other means. Not reachable by Tab, not announced as a
            control, not operable by Enter or Space. On the post card and, since
            the two share PostActionRow, on the sponsored ad card too.

            A `<button>` fixes all of it at once and needs no key handling of its
            own: the platform gives Enter and Space, focus order and the role for
            free, and every hand-rolled `role="button" + tabIndex={0} +
            onKeyDown` is a re-implementation of something the element already
            does correctly. Tailwind's preflight strips a button's UA border,
            background and padding, so nothing moves.

            THE COUNT IS IN THE NAME on purpose. An `aria-label` REPLACES the
            content for assistive tech, so a bare "See who reacted" would have
            silently thrown away the number this control is wrapped around — a
            sighted member reads "3", a screen-reader member would have heard
            nothing at all. Both triggers on a row (the total and the break-up)
            open the same dialog, so they share the name deliberately.
          */}
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={handleOpen}
              aria-label={`See who reacted (${totalCount})`}
              className="cursor-pointer inline-flex items-center"
            >
              {children}
            </button>
          </TooltipTrigger>
          <TooltipContent
            side="top"
            sideOffset={6}
            className="bg-popover text-popover-foreground border border-border rounded-lg shadow-xl px-3 py-2 min-w-[120px]"
          >
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-4 text-xs font-semibold">
                <span>All</span>
                <span>{totalCount}</span>
              </div>
              {breakdown.map(({ emoji, label, count }) => (
                <div key={label} className="flex items-center justify-between gap-4 text-xs">
                  <span className="flex items-center gap-1.5">
                    <span className="text-sm">{emoji}</span>
                    <span className="text-muted-foreground">{label}</span>
                  </span>
                  <span className="font-medium">{count}</span>
                </div>
              ))}
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      {/* Click-to-open dialog with names */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm w-[90vw] sm:w-full p-0 gap-0">
          <DialogHeader className="px-4 pt-4 pb-0">
            <DialogTitle className="text-base font-semibold">Reactions</DialogTitle>
          </DialogHeader>

          {/* Tabs */}
          <div className="flex border-b border-border px-2 mt-2 overflow-x-auto">
            <button
              onClick={() => setActiveTab("all")}
              className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                activeTab === "all"
                  ? "border-primary text-primary"
                  : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              All {totalCount}
            </button>
            {breakdown.map(({ type, emoji, count }) => (
              <button
                key={type}
                onClick={() => setActiveTab(type)}
                className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                  activeTab === type
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {emoji} {count}
              </button>
            ))}
          </div>

          {/* User list */}
          <div className="max-h-72 overflow-y-auto px-4 py-2">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No reactions yet</p>
            ) : (
              <div className="space-y-1">
                {filtered.map((reactor, i) => {
                   const reactionEmoji = REACTIONS.find(r => r.type === reactor.reaction_type)?.emoji || "👍";
                   return (
                     <div
                       key={`${reactor.user_id}-${reactor.reaction_type}-${i}`}
                       className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-muted/50 transition-colors group"
                     >
                       <Link
                         to={`/profile/${reactor.user_id}`}
                         onClick={() => setOpen(false)}
                         className="relative shrink-0"
                       >
                         {reactor.avatar_url ? (
                           <img referrerPolicy="no-referrer" loading="lazy" decoding="async" src={reactor.avatar_url} alt="" className="w-9 h-9 rounded-full object-cover" />
                         ) : (
                           <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center text-sm font-semibold text-muted-foreground">
                             {(reactor.full_name || "?")[0]?.toUpperCase()}
                           </div>
                         )}
                         <span className="absolute -bottom-0.5 -right-0.5 text-xs leading-none bg-card rounded-full p-px">
                           {reactionEmoji}
                         </span>
                       </Link>
                         <div className="flex-1 min-w-0">
                           <UserIdentityBlock
                             userId={reactor.user_id}
                             name={reactor.full_name}
                             linkTo={`/profile/${reactor.user_id}`}
                             nameClassName="text-sm font-medium group-hover:text-primary transition-colors truncate"
                           />
                         </div>
                        <ReactorFriendAction targetUserId={reactor.user_id} />
                     </div>
                   );
                 })}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default ReactionSummaryTooltip;
