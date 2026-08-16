import { UserPlus, UserMinus, UserCheck, Users, Heart, Clock } from "lucide-react";
import { useFriendFollow } from "@/hooks/social/useFriendFollow";
import { useNavigate, Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

interface Props {
  targetUserId: string;
}

const headingFont = { fontFamily: "var(--font-heading)" };

/** Stats-only row: Friends • Followers • Following */
export const FriendFollowStats = ({ targetUserId }: Props) => {
  const { friendCount, followerCount, followingCount } = useFriendFollow(targetUserId);

  return (
    <div className="flex items-center gap-1.5 text-[9px] tracking-[0.04em] text-muted-foreground whitespace-nowrap" style={headingFont}>
      <span>Friends ({friendCount})</span>
      <span className="text-border">·</span>
      <span>Followers ({followerCount})</span>
      <span className="text-border">·</span>
      <span>Following ({followingCount})</span>
    </div>
  );
};

/**
 * THE THREE NUMBERS BESIDE THE DISPLAY PICTURE — Instagram's arrangement.
 *
 * Owner, 2026-08-16, with his Instagram profile open next to ours: *"DP
 * missing too bad laytout. follow instagram style as attched."*
 *
 * `FriendFollowStats` above renders the same figures as a 9px run of text —
 * "Friends (41) · Followers (1204) · Following (87)" — centred under the name.
 * That is a caption, not a statistic: it is the smallest type on the screen
 * carrying the numbers a visitor judges a photographer by. This is the same
 * data as a proper stat row, big figure over small label, sized to be read.
 *
 * The POSTS count is not in `profile_stats` (checked against the live schema,
 * not assumed — that table has followers/following/friends only), so it is a
 * HEAD count: `head: true` returns the count in a header and no rows, one
 * cheap request rather than pulling the wall down a second time.
 *
 * Every figure is a 44px tap target, and followers/following are real links —
 * on Instagram tapping them opens the list, and a number that looks tappable
 * and is not is worse than plain text. Counts fail SOFT to an em dash: a
 * profile that cannot show a number must never show a wrong one.
 */
export const ProfileStatRow = ({ targetUserId }: Props) => {
  const { followerCount, followingCount } = useFriendFollow(targetUserId);
  const [postCount, setPostCount] = useState<number | null>(null);

  useEffect(() => {
    if (!targetUserId) return;
    let cancelled = false;
    supabase
      .from("posts")
      .select("id", { count: "exact", head: true })
      .eq("user_id", targetUserId)
      .then(({ count }) => {
        if (!cancelled) setPostCount(count ?? null);
      });
    return () => {
      cancelled = true;
    };
  }, [targetUserId]);

  const items = [
    { key: "posts", value: postCount, label: "posts", to: null as string | null },
    { key: "followers", value: followerCount, label: "followers", to: "/friends?tab=followers" },
    { key: "following", value: followingCount, label: "following", to: "/friends?tab=following" },
  ];

  /**
   * MEASURED OFF THE OWNER'S REAL-INSTAGRAM REFERENCE, 2026-08-16.
   * The three figures sit LEFT-ALIGNED in a row, figure over label, each
   * column as wide as its own text, with even gaps between — NOT stretched
   * to fill the width, NOT centred, NO dividers. Figures ~17px semibold,
   * labels ~15px regular. `justify-between` on a bounded row gives exactly
   * that: first column flush left, last flush right, the middle where the
   * text puts it. Left-aligned inside each column so "1" and "1,743" both
   * hang off the same left edge as the name above.
   */
  return (
    <div className="flex min-w-0 flex-1 items-start justify-between gap-3 pr-2">
      {items.map((s) => {
        const body = (
          <>
            <span className="text-[17px] font-semibold leading-tight tabular-nums text-foreground">
              {s.value === null || s.value === undefined ? "—" : Number(s.value).toLocaleString()}
            </span>
            <span className="text-[14px] leading-tight text-foreground/90">{s.label}</span>
          </>
        );
        const cell = "flex min-h-11 flex-col items-start justify-center";
        return s.to ? (
          <Link key={s.key} to={s.to} className={cell}>{body}</Link>
        ) : (
          <span key={s.key} className={cell}>{body}</span>
        );
      })}
    </div>
  );
};

/** Action buttons only: Add Friend / Follow */
export const FriendFollowButtons = ({ targetUserId }: Props) => {
  const {
    friendStatus,
    isFollowing,
    loading,
    isSelf,
    isLoggedIn,
    isTargetAdmin,
    sendFriendRequest,
    acceptFriendRequest,
    removeFriend,
    toggleFollow,
  } = useFriendFollow(targetUserId);
  const navigate = useNavigate();

  const requireLogin = () => {
    if (!isLoggedIn) {
      navigate("/login");
      return true;
    }
    return false;
  };

  if (isSelf) return null;

  /**
   * MATCHED TO THE OWNER'S REAL-INSTAGRAM REFERENCE, 2026-08-16.
   *
   * He asked "Where is add frind Follow button ??" — it was here all along,
   * but it only renders for a NON-OWNER and my harness had only ever
   * photographed his own profile, so neither of us had seen it. It was still
   * wearing the old style: 9px UPPERCASE tracked text in a bordered pill,
   * which is exactly the "oversized/generic web component" his spec section 8
   * objects to.
   *
   * The reference row is: a filled primary button, then equal-width secondary
   * buttons, all 36px tall with 8px radius and 14px medium label. No
   * uppercase, no letter-spacing, no borders on the secondary — a filled
   * muted surface instead, which is what makes Instagram's read as native
   * rather than as a web form.
   */
  const btnBase =
    "inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg px-3 text-[14px] font-semibold transition-colors disabled:opacity-50";

  return (
    <div className="flex w-full items-center gap-2">
      {/* Friend button */}
      {!isTargetAdmin && friendStatus === "none" && (
        <button
          onClick={() => !requireLogin() && sendFriendRequest()}
          disabled={loading}
          className={`${btnBase} bg-muted text-foreground hover:bg-muted/80`}
          style={headingFont}
        >
          <UserPlus className="h-3.5 w-3.5" />
          Add Friend
        </button>
      )}
      {friendStatus === "pending_sent" && (
        <button
          onClick={removeFriend}
          disabled={loading}
          className={`${btnBase} bg-muted text-muted-foreground`}
          style={headingFont}
        >
          <Clock className="h-3.5 w-3.5" />
          Request Sent
        </button>
      )}
      {friendStatus === "pending_received" && (
        <button
          onClick={acceptFriendRequest}
          disabled={loading}
          className={`${btnBase} bg-emerald-600 text-white hover:bg-emerald-600/90`}
          style={headingFont}
        >
          <UserCheck className="h-3.5 w-3.5" />
          Accept
        </button>
      )}
      {friendStatus === "accepted" && (
        <button
          onClick={removeFriend}
          disabled={loading}
          className={`${btnBase} bg-muted text-destructive hover:bg-destructive hover:text-destructive-foreground`}
          style={headingFont}
        >
          <UserMinus className="h-3.5 w-3.5" />
          Unfriend
        </button>
      )}

      {/* Follow button */}
      <button
        onClick={() => !requireLogin() && toggleFollow()}
        disabled={loading}
        className={`${btnBase} ${
          isFollowing
            ? "bg-muted text-foreground hover:bg-muted/80"
            : "bg-primary text-primary-foreground hover:opacity-90"
        }`}
        style={headingFont}
      >
        <Heart className={`h-3.5 w-3.5 ${isFollowing ? "fill-current" : ""}`} />
        {isFollowing ? "Following" : "Follow"}
      </button>
    </div>
  );
};

/** Legacy combined component (still used in other places) */
const FriendFollowActions = ({ targetUserId }: Props) => {
  const {
    friendCount,
    followerCount,
    followingCount,
  } = useFriendFollow(targetUserId);

  return (
    <div className="flex flex-col gap-4">
      {/* Counts */}
      <div className="flex flex-wrap items-center gap-4 text-[10px] tracking-[0.15em] uppercase text-muted-foreground" style={headingFont}>
        <span className="inline-flex items-center gap-1.5">
          <Users className="h-3 w-3" />
          <strong className="text-foreground">{friendCount.toLocaleString()}</strong> Friends
        </span>
        <span className="text-border">•</span>
        <span className="inline-flex items-center gap-1.5">
          <Heart className="h-3 w-3" />
          <strong className="text-foreground">{followerCount.toLocaleString()}</strong> Followers
        </span>
        <span className="text-border">•</span>
        <span className="inline-flex items-center gap-1.5">
          <strong className="text-foreground">{followingCount.toLocaleString()}</strong> Following
        </span>
      </div>

      {/* Action buttons */}
      <FriendFollowButtons targetUserId={targetUserId} />
    </div>
  );
};

export default FriendFollowActions;