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

interface ReactionSummaryTooltipProps {
  reactionCounts: Record<string, number>;
  totalCount: number;
  postId: string;
  children: React.ReactNode;
}

interface ReactorUser {
  user_id: string;
  reaction_type: string;
  full_name: string | null;
  avatar_url: string | null;
}

const ReactionSummaryTooltip = ({ reactionCounts, totalCount, postId, children }: ReactionSummaryTooltipProps) => {
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
    const { data } = await supabase
      .from("post_reactions")
      .select("user_id, reaction_type")
      .eq("post_id", postId);

    if (data && data.length > 0) {
      const userIds = [...new Set(data.map(r => r.user_id))];
      const profileMap = await fetchProfileMap(userIds);

      // Badges/roles now come from unified profileMap cache

      setReactors(
        data.map(r => ({
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
  }, [postId]);

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
          <TooltipTrigger asChild>
            <div onClick={handleOpen} className="cursor-pointer">
              {children}
            </div>
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
