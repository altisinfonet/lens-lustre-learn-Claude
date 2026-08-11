/**
 * The like / comment / share row under a sponsored ad.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * Owner, 2026-08-11: "For All sponsored Ad, Like Comment share is required like
 * a normal post."
 *
 * "Like a normal post" is meant literally, so this is PostCard's action row
 * reproduced with the same numbers: ReactionPicker owns the like button, the
 * count sits beside it as a plain number, the comment icon is 24px in a 48px
 * tall tap target, and share is the paper plane. If PostCard's row changes,
 * this changes with it — the two are supposed to look like one thing.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT DELIBERATELY DOES NOT OFFER
 *
 * "Share to your wall". On a post that republishes the post under the sharer's
 * name; doing it with an advertisement would put an ad on a member's own
 * profile, in front of their friends, with their name on it. That is a product
 * decision and not one to take quietly, so the share action copies the ad's
 * permalink and records the share. Raised with the owner.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SIGNED OUT
 *
 * Everything renders, nothing is writable, and the counts are whatever the RPC
 * returned (zero, since an anonymous caller cannot execute it). A tap prompts
 * to sign in rather than failing silently against RLS.
 */
import { useCallback, useEffect, useState } from "react";
import { MessageCircle, Send, Copy } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "@/hooks/core/use-toast";
import { useAuth } from "@/hooks/core/useAuth";
import { publicUrl } from "@/lib/publicUrl";
import { formatNumber } from "@/lib/postAnalytics";
import ReactionPicker, { type ReactionType } from "@/components/ReactionPicker";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  type AdEngagement,
  adPath,
  emptyEngagement,
  fetchAdEngagement,
  reactToAd,
  shareAd,
  unreactToAd,
} from "@/lib/ads/adEngagement";
import AdComments from "@/components/ads/AdComments";

interface Props {
  creativeId: string;
  /**
   * The feed card toggles its thread open underneath itself. The /ad/<id> page
   * has nothing to toggle — the thread is the page — so it passes
   * `commentsAlwaysOpen` and the comment button scrolls rather than collapses.
   */
  commentsAlwaysOpen?: boolean;
  /** The page opens the thread in place; the card links to the page instead. */
  linkToPage?: boolean;
}

const AdEngagementBar = ({ creativeId, commentsAlwaysOpen = false, linkToPage = false }: Props) => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [eng, setEng] = useState<AdEngagement>(() => emptyEngagement(creativeId));
  const [open, setOpen] = useState(commentsAlwaysOpen);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    const map = await fetchAdEngagement([creativeId]);
    setEng(map.get(creativeId) ?? emptyEngagement(creativeId));
  }, [creativeId]);

  useEffect(() => {
    let alive = true;
    fetchAdEngagement([creativeId]).then((map) => {
      if (alive) setEng(map.get(creativeId) ?? emptyEngagement(creativeId));
    });
    return () => {
      alive = false;
    };
  }, [creativeId]);

  const requireSignIn = (): boolean => {
    if (user) return false;
    toast({ title: "Sign in to do that", description: "You need an account to react, comment or share." });
    return true;
  };

  const onReact = async (type: ReactionType) => {
    if (requireSignIn() || busy) return;
    setBusy(true);
    const { error } = await reactToAd(creativeId, user!.id, type);
    setBusy(false);
    if (error) {
      toast({ title: "Could not save that reaction", description: error, variant: "destructive" });
      return;
    }
    reload();
  };

  const onUnreact = async () => {
    if (requireSignIn() || busy) return;
    setBusy(true);
    const { error } = await unreactToAd(creativeId, user!.id);
    setBusy(false);
    if (error) {
      toast({ title: "Could not remove that reaction", description: error, variant: "destructive" });
      return;
    }
    reload();
  };

  const copyLink = async () => {
    const url = publicUrl(adPath(creativeId));
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: "Link copied to clipboard!" });
    } catch {
      // Clipboard is refused in some embedded webviews. Say so rather than
      // pretending it worked — the URL is on screen in the address bar anyway.
      toast({ title: "Could not copy the link", description: url });
    }
    // A copied link IS the share on an ad, so it is what gets recorded.
    if (user) {
      const { error } = await shareAd(creativeId, user.id);
      if (!error) reload();
    }
  };

  const onCommentClick = () => {
    if (linkToPage) {
      navigate(adPath(creativeId));
      return;
    }
    setOpen((v) => !v);
  };

  return (
    <>
      {/* Same geometry as PostCard's row: 24px icons, 48px tall, pushed left. */}
      <div className="select-none px-1.5">
        <div className="flex items-center">
          <div className="flex items-center">
            <ReactionPicker
              currentReaction={(eng.myReaction as ReactionType | null) ?? null}
              onReact={onReact}
              onUnreact={onUnreact}
              disabled={busy}
            />
            {eng.likeCount > 0 && (
              <span className="pr-2 text-sm font-semibold text-foreground">
                {formatNumber(eng.likeCount)}
              </span>
            )}
          </div>

          <button
            onClick={onCommentClick}
            aria-label="Comment"
            title="Comment"
            className="h-12 px-2.5 flex items-center gap-1.5 rounded-md text-muted-foreground hover:bg-muted/50 transition-colors select-none touch-manipulation"
          >
            <MessageCircle className="h-6 w-6" strokeWidth={1.75} />
            {eng.commentCount > 0 && (
              <span className="text-sm font-semibold text-foreground">
                {formatNumber(eng.commentCount)}
              </span>
            )}
          </button>

          <div className="flex items-center">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  aria-label="Share"
                  title="Share"
                  className="h-12 px-2.5 flex items-center justify-center rounded-md text-muted-foreground hover:bg-muted/50 transition-colors select-none touch-manipulation"
                >
                  <Send className="h-6 w-6" strokeWidth={1.75} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem onClick={copyLink} className="py-2.5 cursor-pointer">
                  <Copy className="h-4 w-4 mr-2.5" /> Copy link
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {eng.shareCount > 0 && (
              <span className="pr-2 text-sm font-semibold text-foreground">
                {formatNumber(eng.shareCount)}
              </span>
            )}
          </div>
        </div>
      </div>

      {open && (
        <AdComments
          creativeId={creativeId}
          onCountChange={reload}
        />
      )}
    </>
  );
};

export default AdEngagementBar;
