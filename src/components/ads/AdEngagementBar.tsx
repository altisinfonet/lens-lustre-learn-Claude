/**
 * The like / comment / share row under a sponsored ad.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * Owner, 2026-08-11: "For All sponsored Ad, Like Comment share is required like
 * a normal post."
 *
 * "Like a normal post" is meant literally. This file used to make that true by
 * REPRODUCING PostCard's action row here, under a comment promising that if
 * PostCard's row ever changed, this one would change with it. Nothing enforced
 * the promise and the two drifted anyway: the shipped bundle carried two
 * different "Add a comment" composers, and the thread under this row printed
 * the literal string `renderRow(comment, false)` where a member's comment
 * should have been.
 *
 * So it is the same row now, not a copy of it — src/components/post/
 * PostActionRow.tsx — and the thread under it is the same thread the post card
 * draws. What is left here is the AD's half: the ad_creative_* reads and
 * writes, and the one place the two surfaces genuinely differ.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE STORY-CARD TAP OPENS THE SAME OVERLAY A POST'S DOES (2026-09-12)
 *
 * Owner: "In the Ads section same type of commenting not happening exactly
 * like posts." He was right — "like a normal post" covered the row and the
 * thread (both above), but not WHERE the thread appears. It still expanded
 * inline under the card, pushing every post below it down the feed — the
 * exact pattern src/contexts/CommentsOverlayContext.tsx replaced for posts on
 * 2026-09-09, left standing here only because nobody had come back to it.
 *
 * `commentsAlwaysOpen` (below) is untouched: the /ad/<id> page's thread IS the
 * page, same as PostDetail's, and neither belongs in an overlay over itself.
 * Only the feed-card tap now calls `openAdComments`, so it opens the SAME
 * Dialog/Drawer a post's comment icon does, not a second ad-shaped one.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ONE PLACE THEY DIFFER: "SHARE TO YOUR WALL"
 *
 * On a post that republishes the post under the sharer's name; doing it with an
 * advertisement would put an ad on a member's own profile, in front of their
 * friends, with their name on it. That is a product decision and not one to
 * take quietly, so the share menu here offers Copy link only, and the copy
 * records the share. Raised with the owner. The menu is a prop on the shared
 * row precisely so this stays a stated decision rather than a missing branch.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SIGNED OUT
 *
 * Everything renders, nothing is writable, and the counts are whatever the RPC
 * returned (zero, since an anonymous caller cannot execute it). A tap prompts
 * to sign in rather than failing silently against RLS.
 */
import { useCallback, useEffect, useState } from "react";
import { Copy } from "lucide-react";
import { toast } from "@/hooks/core/use-toast";
import { useAuth } from "@/hooks/core/useAuth";
import { publicUrl } from "@/lib/publicUrl";
import { useCommentsOverlay } from "@/contexts/CommentsOverlayContext";
import type { ReactionType } from "@/components/ReactionPicker";
import PostActionRow from "@/components/post/PostActionRow";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
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
  /** The creative's own picture — shown beside the thread in the overlay, same as a post's photo. Unused when `commentsAlwaysOpen`. */
  imageUrl?: string | null;
  /**
   * The feed card opens its thread in the SAME comments overlay a post's
   * comment icon opens (CommentsOverlayContext) — never a second, ad-shaped
   * modal. The /ad/<id> page has nothing to open — the thread is the page —
   * so it passes `commentsAlwaysOpen` and renders the thread inline instead.
   */
  commentsAlwaysOpen?: boolean;
}

const AdEngagementBar = ({ creativeId, imageUrl = null, commentsAlwaysOpen = false }: Props) => {
  const { user } = useAuth();
  const { openAdComments } = useCommentsOverlay();
  const [eng, setEng] = useState<AdEngagement>(() => emptyEngagement(creativeId));
  const [inlineOpen, setInlineOpen] = useState(commentsAlwaysOpen);
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

  // Removed 2026-08-11: a `linkToPage` prop that navigated to /ad/<id> instead
  // of expanding. No caller ever passed it, and an unused branch in a component
  // this small is just a lie about how it behaves. The card expands; the page
  // opens the thread already.
  //
  // 2026-09-12: "expands" now means the shared overlay, not an inline strip —
  // see the file banner above. commentsAlwaysOpen (the /ad/<id> page) still
  // toggles the thread it already renders inline; that page has no overlay to
  // open in the first place.
  const onCommentClick = () => {
    if (commentsAlwaysOpen) {
      setInlineOpen((v) => !v);
      return;
    }
    openAdComments(creativeId, imageUrl, reload);
  };

  return (
    <>
      <PostActionRow
        currentReaction={(eng.myReaction as ReactionType | null) ?? null}
        onReact={onReact}
        onUnreact={onUnreact}
        reactionDisabled={busy}
        likeCount={eng.likeCount}
        commentCount={eng.commentCount}
        shareCount={eng.shareCount}
        reactionCounts={eng.reactionCounts}
        reactionSource={{ kind: "ad", creativeId }}
        onCommentClick={onCommentClick}
        commentLabel="Comment"
        shareLabel="Share"
        shareMenu={
          <DropdownMenuItem onClick={copyLink} className="py-2.5 cursor-pointer">
            <Copy className="h-4 w-4 mr-2.5" /> Copy link
          </DropdownMenuItem>
        }
      />

      {/* Only the /ad/<id> page reaches this — the feed card's thread now
          lives in the shared overlay, opened by onCommentClick above. */}
      {commentsAlwaysOpen && inlineOpen && (
        <AdComments
          creativeId={creativeId}
          onCountChange={reload}
        />
      )}
    </>
  );
};

export default AdEngagementBar;
