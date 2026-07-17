import { useState, useCallback } from "react";
import { Link } from "react-router-dom";
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
import { Loader2, Share2 } from "lucide-react";
import ReactorFriendAction from "@/components/ReactorFriendAction";
import UserIdentityBlock from "@/components/UserIdentityBlock";

interface ShareSummaryTooltipProps {
  shareCount: number;
  postId: string;
  children: React.ReactNode;
}

interface SharerUser {
  user_id: string;
  full_name: string | null;
  avatar_url: string | null;
  created_at: string;
}

const ShareSummaryTooltip = ({ shareCount, postId, children }: ShareSummaryTooltipProps) => {
  const [open, setOpen] = useState(false);
  const [sharers, setSharers] = useState<SharerUser[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchSharers = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("post_shares" as any)
      .select("user_id, created_at")
      .eq("post_id", postId)
      .order("created_at", { ascending: false });

    if (data && data.length > 0) {
      const userIds = [...new Set((data as any[]).map((r: any) => r.user_id))];
      const profileMap = await fetchProfileMap(userIds);

      setSharers(
        (data as any[]).map((r: any) => ({
          user_id: r.user_id,
          full_name: profileMap.get(r.user_id)?.full_name || "Unknown",
          avatar_url: profileMap.get(r.user_id)?.avatar_url || null,
          created_at: r.created_at,
        }))
      );
    } else {
      setSharers([]);
    }
    setLoading(false);
  }, [postId]);

  const handleOpen = () => {
    if (shareCount === 0) return;
    setOpen(true);
    fetchSharers();
  };

  if (shareCount === 0) return <>{children}</>;

  return (
    <>
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
            <div className="flex items-center gap-2 text-xs font-semibold">
              <Share2 className="h-3 w-3" />
              <span>{shareCount} {shareCount === 1 ? "share" : "shares"}</span>
            </div>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm w-[90vw] sm:w-full p-0 gap-0">
          <DialogHeader className="px-4 pt-4 pb-2">
            <DialogTitle className="text-base font-semibold">Shared by</DialogTitle>
          </DialogHeader>

          <div className="max-h-72 overflow-y-auto px-4 py-2">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : sharers.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">No shares yet</p>
            ) : (
              <div className="space-y-1">
                {sharers.map((sharer, i) => (
                  <div
                    key={`${sharer.user_id}-${i}`}
                    className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-muted/50 transition-colors group"
                  >
                    <Link
                      to={`/profile/${sharer.user_id}`}
                      onClick={() => setOpen(false)}
                      className="relative shrink-0"
                    >
                      {sharer.avatar_url ? (
                        <img referrerPolicy="no-referrer" loading="lazy" decoding="async" src={sharer.avatar_url} alt="" className="w-9 h-9 rounded-full object-cover" />
                      ) : (
                        <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center text-sm font-semibold text-muted-foreground">
                          {(sharer.full_name || "?")[0]?.toUpperCase()}
                        </div>
                      )}
                    </Link>
                    <div className="flex-1 min-w-0">
                      <UserIdentityBlock
                        userId={sharer.user_id}
                        name={sharer.full_name}
                        linkTo={`/profile/${sharer.user_id}`}
                        nameClassName="text-sm font-medium group-hover:text-primary transition-colors truncate"
                      />
                    </div>
                    <ReactorFriendAction targetUserId={sharer.user_id} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default ShareSummaryTooltip;
