import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { fadeUp } from "@/lib/motionVariants";
import { Link, useNavigate } from "react-router-dom";
import { Users, Heart, UserMinus, UserX, UserCheck, Search, Clock, ChevronLeft, ChevronRight } from "lucide-react";
import { useAuth } from "@/hooks/core/useAuth";
import { useIsAdmin } from "@/hooks/core/useIsAdmin";
import { useUserBadgesBatch } from "@/hooks/profile/useUserBadges";
import { supabase } from "@/integrations/supabase/client";
import { useAcceptFriendRequest, useRemoveFriendship, useToggleFollow } from "@/hooks/social/useFriendshipMutations";
import { profilesPublic } from "@/lib/profilesPublic";
import { toast } from "@/hooks/core/use-toast";
import { motion } from "framer-motion";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import UserIdentityBlock from "@/components/UserIdentityBlock";
import { getAdminIds, resolveName } from "@/lib/adminBrand";
import ProfileLink from "@/components/ProfileLink";
import { formatLastSeen, isActiveNow } from "@/hooks/core/useLastActive";
import { useT } from "@/i18n/I18nContext";

interface FriendProfile {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  city: string | null;
  country: string | null;
  custom_url: string | null;
  last_active_at: string | null;
}

interface FriendRow {
  friendshipId: string;
  profile: FriendProfile;
  since: string;
}

interface FollowRow {
  id: string;
  profile: FriendProfile;
  since: string;
}

interface PendingRequest {
  friendshipId: string;
  profile: FriendProfile;
  since: string;
  direction: "sent" | "received";
}

const headingFont = { fontFamily: "var(--font-heading)" };
const bodyFont = { fontFamily: "var(--font-body)" };
const displayFont = { fontFamily: "var(--font-display)" };


const Friends = () => {
  const t = useT();
  const { user, loading: authLoading } = useAuth();
  const { isAdmin } = useIsAdmin();
  const navigate = useNavigate();
  const acceptMutation = useAcceptFriendRequest();
  const removeMutation = useRemoveFriendship();
  const followMutation = useToggleFollow();
  const [friends, setFriends] = useState<FriendRow[]>([]);
  const [followers, setFollowers] = useState<FollowRow[]>([]);
  const [following, setFollowing] = useState<FollowRow[]>([]);
  const [pendingRequests, setPendingRequests] = useState<PendingRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  /**
   * ── THE AWAITED/PENDING/FRIENDS/FOLLOWERS/FOLLOWING ROW REACHES ALL FIVE ──
   *
   * Owner, 2026-09-15: "buttons and not scrollable, same for app too" — the row
   * was a bare `overflow-x-auto`, and src/components/feed/CategoryStrip.tsx
   * already diagnosed this exact failure mode for the feed's category strip:
   * "the first version was a bare overflow-x-auto row. On a phone that swipes
   * fine. On a desktop it is a trap: there is no touch, a mouse wheel scrolls
   * the PAGE not the row" — and with `scrollbar-hide` there is not even a
   * visible track hinting more exists. Reported on the app too: five pills at
   * this row's ~44px height sit inside a page that scrolls VERTICALLY, so a
   * finger aimed at the row is easily read as a page scroll instead of a row
   * scroll — a narrow horizontal lane is simply an easy miss.
   *
   * Same fix, same reasoning, reused rather than reinvented: `‹ ›` arrows that
   * only render while there IS overflow in that direction (measured on mount,
   * on every scroll, and on resize — the tab set itself never changes size
   * after mount here, unlike the category strip's fetched list, but window
   * width does), so tapping/clicking is a guaranteed way to reach every tab
   * regardless of touch accuracy, trackpad gesture support, or a mouse with a
   * plain vertical wheel. Swiping still works exactly as before — this only
   * ADDS a second, always-reachable way in.
   */
  const tabRowRef = useRef<HTMLDivElement>(null);
  const [tabRowCanLeft, setTabRowCanLeft] = useState(false);
  const [tabRowCanRight, setTabRowCanRight] = useState(false);

  const measureTabRow = useCallback(() => {
    const el = tabRowRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setTabRowCanLeft(el.scrollLeft > 1);
    // 1px slack — fractional widths land scrollLeft at max - 0.5, not max.
    setTabRowCanRight(el.scrollLeft < max - 1);
  }, []);

  const nudgeTabRow = (dir: -1 | 1) => {
    tabRowRef.current?.scrollBy({ left: dir * 220, behavior: "smooth" });
  };

  useEffect(() => {
    if (!authLoading && !user) navigate("/login");
  }, [user, authLoading, navigate]);

  const [mutualCounts, setMutualCounts] = useState<Map<string, number>>(new Map());
  const [mutualProfiles, setMutualProfiles] = useState<Map<string, { id: string; full_name: string | null; avatar_url: string | null; custom_url: string | null }[]>>(new Map());

  const fetchAll = useCallback(async () => {
    if (!user) return;

    const [friendshipsRes, followersRes, followingRes, pendingRes] = await Promise.all([
      supabase.from("friendships")
        .select("id, requester_id, addressee_id, created_at")
        .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`)
        .eq("status", "accepted"),
      supabase.from("follows")
        .select("id, follower_id, created_at")
        .eq("following_id", user.id),
      supabase.from("follows")
        .select("id, following_id, created_at")
        .eq("follower_id", user.id),
      supabase.from("friendships")
        .select("id, requester_id, addressee_id, created_at")
        .or(`requester_id.eq.${user.id},addressee_id.eq.${user.id}`)
        .eq("status", "pending"),
    ]);

    // Collect all user IDs we need profiles for
    const userIds = new Set<string>();
    friendshipsRes.data?.forEach((f) => {
      userIds.add(f.requester_id === user.id ? f.addressee_id : f.requester_id);
    });
    followersRes.data?.forEach((f) => userIds.add(f.follower_id));
    followingRes.data?.forEach((f) => userIds.add(f.following_id));
    pendingRes.data?.forEach((f) => {
      userIds.add(f.requester_id === user.id ? f.addressee_id : f.requester_id);
    });

    // Batch fetch all profiles
    const profileMap = new Map<string, FriendProfile>();
    const adminIds = await getAdminIds();
    if (userIds.size > 0) {
      const { data: profiles } = await profilesPublic()
        .select("id, full_name, avatar_url, bio, current_city, custom_url, last_active_at")
        .in("id", Array.from(userIds));
      profiles?.forEach((p: any) => {
        const resolved = {
          ...p,
          full_name: resolveName(p.id, p.full_name, adminIds),
          city: p.current_city ?? null,
          country: null,
        };
        profileMap.set(p.id, resolved);
      });
    }

    // Batch fetch mutual friend counts — 2 queries total instead of N*2
    const otherIds = Array.from(userIds);
    const mcMap = new Map<string, number>();
    const mpMap = new Map<string, { id: string; full_name: string | null; avatar_url: string | null; custom_url: string | null }[]>();

    if (otherIds.length > 0) {
      // Single batch RPC for counts
      const countResults = await Promise.all(
        // Use chunks of 20 to avoid overly large RPC calls
        [otherIds].map(async (chunk) => {
          const results: { uid: string; count: number; friendIds: string[] }[] = [];
          // Fire counts in parallel but batched (max 20 concurrent)
          const batchSize = 20;
          for (let i = 0; i < chunk.length; i += batchSize) {
            const batch = chunk.slice(i, i + batchSize);
            const batchResults = await Promise.all(
              batch.map(async (uid) => {
                const { data: count } = await supabase.rpc("mutual_friends_count" as any, { _user_a: user.id, _user_b: uid });
                const total = (count as number) ?? 0;
                let friendIds: string[] = [];
                if (total > 0) {
                  const { data: ids } = await supabase.rpc("mutual_friend_ids" as any, { _user_a: user.id, _user_b: uid, _limit: 3 });
                  friendIds = ((ids as any[]) || []).map((r: any) => r.friend_id);
                }
                return { uid, count: total, friendIds };
              })
            );
            results.push(...batchResults);
          }
          return results;
        })
      );

      const allMutualFriendIds = new Set<string>();
      countResults.flat().forEach((r) => {
        mcMap.set(r.uid, r.count);
        r.friendIds.forEach((id) => allMutualFriendIds.add(id));
      });

      // Single batch profile fetch for all mutual friends
      if (allMutualFriendIds.size > 0) {
        const { data: mProfiles } = await profilesPublic()
          .select("id, full_name, avatar_url, custom_url")
          .in("id", Array.from(allMutualFriendIds));
        const mProfileMap = new Map((mProfiles || []).map((p: any) => [p.id, p]));

        countResults.flat().forEach((r) => {
          if (r.friendIds.length > 0) {
            mpMap.set(r.uid, r.friendIds.map((id) => mProfileMap.get(id)).filter(Boolean) as any);
          }
        });
      }
    }

    setMutualCounts(mcMap);
    setMutualProfiles(mpMap);

    const fallback: FriendProfile = { id: "", full_name: "Unknown", avatar_url: null, bio: null, city: null, country: null, custom_url: null, last_active_at: null };

    setFriends(
      (friendshipsRes.data || []).map((f) => {
        const otherId = f.requester_id === user.id ? f.addressee_id : f.requester_id;
        return { friendshipId: f.id, profile: profileMap.get(otherId) || { ...fallback, id: otherId }, since: f.created_at };
      })
    );

    setFollowers(
      (followersRes.data || []).map((f) => ({
        id: f.id, profile: profileMap.get(f.follower_id) || { ...fallback, id: f.follower_id }, since: f.created_at,
      }))
    );

    setFollowing(
      (followingRes.data || []).map((f) => ({
        id: f.id, profile: profileMap.get(f.following_id) || { ...fallback, id: f.following_id }, since: f.created_at,
      }))
    );

    setPendingRequests(
      (pendingRes.data || []).map((f) => {
        const otherId = f.requester_id === user.id ? f.addressee_id : f.requester_id;
        return {
          friendshipId: f.id,
          profile: profileMap.get(otherId) || { ...fallback, id: otherId },
          since: f.created_at,
          direction: f.requester_id === user.id ? "sent" : "received",
        };
      })
    );

    setLoading(false);
  }, [user]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const removeFriend = async (friendshipId: string) => {
    setActionLoading(friendshipId);
    try {
      await removeMutation.mutateAsync(friendshipId);
      setFriends((prev) => prev.filter((f) => f.friendshipId !== friendshipId));
    } catch { /* handled by hook */ }
    setActionLoading(null);
  };

  const unfollow = async (followId: string, followingId: string) => {
    setActionLoading(followId);
    try {
      await followMutation.mutateAsync({ targetUserId: followingId, isCurrentlyFollowing: true });
      setFollowing((prev) => prev.filter((f) => f.id !== followId));
    } catch { /* handled by hook */ }
    setActionLoading(null);
  };

  const acceptRequest = async (friendshipId: string, requesterId: string) => {
    setActionLoading(friendshipId);
    try {
      await acceptMutation.mutateAsync({ friendshipId, targetUserId: requesterId });
      await fetchAll();
    } catch { /* handled by hook */ }
    setActionLoading(null);
  };

  const declineRequest = async (friendshipId: string) => {
    setActionLoading(friendshipId);
    try {
      await removeMutation.mutateAsync(friendshipId);
      setPendingRequests((prev) => prev.filter((r) => r.friendshipId !== friendshipId));
    } catch { /* handled by hook */ }
    setActionLoading(null);
  };

  const filterBySearch = (profile: FriendProfile) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (profile.full_name || "").toLowerCase().includes(q) ||
      (profile.city || "").toLowerCase().includes(q) ||
      (profile.country || "").toLowerCase().includes(q);
  };

  // "Awaited" = requests RECEIVED (others want to be my friend) — accept one by one.
  // "Pending" = requests I SENT — waiting for the other side.
  const receivedRequests = useMemo(
    () => pendingRequests.filter((r) => r.direction === "received"),
    [pendingRequests],
  );
  const sentRequests = useMemo(
    () => pendingRequests.filter((r) => r.direction === "sent"),
    [pendingRequests],
  );

  const allListedUserIds = useMemo(
    () => Array.from(new Set([
      ...pendingRequests.map((r) => r.profile.id),
      ...friends.map((f) => f.profile.id),
      ...followers.map((f) => f.profile.id),
      ...following.map((f) => f.profile.id),
    ].filter(Boolean))),
    [pendingRequests, friends, followers, following]
  );
  const badgeMap = useUserBadgesBatch(allListedUserIds);

  // Re-measure whenever the tab set's total width can change: the counts in
  // each label, "Pending" appearing/disappearing (sentRequests.length > 0),
  // and the viewport itself.
  useEffect(() => {
    measureTabRow();
    window.addEventListener("resize", measureTabRow);
    return () => window.removeEventListener("resize", measureTabRow);
  }, [measureTabRow, receivedRequests.length, sentRequests.length, friends.length, followers.length, following.length]);

  if (authLoading || loading || !user) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-xs tracking-[0.3em] uppercase text-muted-foreground animate-pulse" style={headingFont}>
          Loading...
        </div>
      </main>
    );
  }

  const formatDate = (d: string) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="container mx-auto py-3 md:py-20">

        <motion.div initial="hidden" animate="visible">
          <motion.div variants={fadeUp} custom={0} className="mb-4 md:mb-10 px-2 md:px-0">
            <div className="flex items-center gap-4 mb-2">
              <div className="w-12 h-px bg-primary" />
              <span className="text-[10px] tracking-[0.3em] uppercase text-primary" style={headingFont}>
                {t("fr.connections")}
              </span>
            </div>
            <h1 className="text-xl md:text-3xl font-light tracking-tight mb-3 md:mb-6" style={displayFont}>
              {t("fr.friendsAmp")} <em className="italic text-primary">{t("fr.network")}</em>
            </h1>

            {/* Summary stats */}
          </motion.div>

          <motion.div variants={fadeUp} custom={1}>
            {/* Search */}
            <div className="relative max-w-sm mb-4 md:mb-8 px-2 md:px-0">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("fr.searchByName")}
                className="pl-9 bg-transparent text-sm"
              />
            </div>

            <Tabs defaultValue={receivedRequests.length > 0 ? "awaited" : sentRequests.length > 0 ? "pending" : "friends"} className="w-full">
              {/*
                * ═══════════════════════════════════════════════════════════════
                * F-108 — overflow-x: auto CLIPS VERTICALLY TOO.
                *
                * CSS does not let one axis scroll while the other overflows
                * visibly: setting overflow-x to auto forces overflow-y to auto
                * as well. Measured — getComputedStyle on this very element
                * reports overflowY=auto — and this container is exactly
                * tab-height, so the 44px hit regions on the five triggers were
                * cut back to the painted 31px:
                *
                *   awaited    painted 105x31  region h=44  cutPx=12.6
                *   friends    painted 102x31  region h=44  cutPx=12.6
                *   followers  painted 113x31  region h=44  cutPx=12.6
                *   following  painted 113x31  region h=44  cutPx=12.6
                *
                * clipped by div.overflow-x-auto.scrollbar-hide — this div. The
                * tabs were no better off than before the hit region was added,
                * which is the whole reason F-108 asks whether an ancestor clips
                * a region rather than only whether the region is 44px.
                *
                * THE FIX IS ROOM, NOT SIZE — the tabs are NOT made 44px tall,
                * which would be a redesign nobody asked for. Overflow clips at
                * the PADDING BOX, so vertical padding gives the region a place
                * to live and an equal negative margin pulls the box back.
                *
                * This file already knew the technique: `-mx-2 px-2` is the same
                * trick on the horizontal axis, two classes to the left. It had
                * simply never been applied vertically.
                *
                * ⚠ F-108b — PADDING ALONE WAS A CONSTANT FITTED TO ONE FONT,
                * AND IT SHIPPED BROKEN. The first fix was `py-[7px] -my-[7px]`
                * and nothing else, sized against a tab measured at 31.4 — at
                * 360px, the only width I checked. The DEPLOYED tab is 28.1:
                * 28.1 + 7 + 7 = 42.1, short of 44, and the Auditor measured
                * cutPx 1.9 on all five tabs at 1536. The harness reproduces it
                * once asked at the right width — 28.5 painted, container 42.5,
                * cutPx 1.5. A tab is not a fixed height: a font swap, a
                * line-height change or a text-size setting moves it, and every
                * such move would break a padding constant again.
                *
                * SO THE FLOOR IS DECLARED, NOT ARITHMETIC:
                *
                *   min-h-[44px]     the padding box can never be under 44,
                *                    whatever the tab measures.
                *   flex items-center  the tab sits at the CENTRE of that box.
                *
                * The second class is not decoration. `.tap-44`'s region is
                * centred on its control, so it reaches (44 − tabH)/2 above and
                * below. A 44px box with the tab at its TOP still clips 0.75px
                * off the top at a 28.5 tab — the floor without the symmetry is
                * a fix that measures right and taps wrong.
                *
                * Proven by FORCING the tab height rather than by trusting the
                * one it happens to have — 24, 28, 34 and native, at 360 and
                * 1536: cutPx 0 at every one. See docs/evidence/d2/F-108b/.
                *
                * ⚠ WHAT THIS COSTS, STATED PLAINLY: where the tab is under
                * 30px the floor makes the row 30px instead, so content below
                * moves DOWN by (30 − tabH) — 1.5px at the deployed 28.5, 6px
                * at a forced 24. Nothing moves at 30px or taller. Guaranteeing
                * a 44px clip window while keeping a sub-44 layout box is not
                * possible without a negative margin that scales with the
                * shortfall, which is the same fitted constant in another hat.
                * The 1.5px is the honest price of the guarantee.
                *
                * The outer margins move to a wrapper so `-my` and `mb` cannot
                * both set margin-bottom — Tailwind resolves that collision by
                * stylesheet order, not by class order, which is not a thing to
                * leave to chance.
                * ═══════════════════════════════════════════════════════════════
                */}
              {/*
                * `‹ ›` ARROWS LIVE IN NORMAL FLOW, NOT AS AN OVERLAY.
                *
                * Owner, 2026-09-15, on the round-button version: same
                * screenshot as before, "Following" still half-covered, this
                * time by a solid circle instead of a gradient. That version
                * fixed the CONTRAST problem (solid circle reads against any
                * tab colour) but not the real defect underneath it, which a
                * live measurement on staging exposed: at a full 1707px
                * desktop window — nowhere near narrow — scrollWidth was 538
                * against a clientWidth of 531. Seven px of true overflow,
                * yet the button visibly ate a third of "Following". Seven
                * px does not explain that; the button's own position does.
                *
                * The button was `absolute`, stacked on top of the scroll
                * container with no room made for it — CategoryStrip's
                * BUTTON STYLE got copied, but not CategoryStrip's `mr-9` /
                * `pr-20` reservation that makes the button's own footprint
                * come out of the scrollable width instead of sitting on
                * top of it. Without that, the last tab renders right up to
                * the container's true edge and the button simply covers
                * whatever happens to be there — this row's tabs are wider
                * than CategoryStrip's chips, so the cover was wide enough
                * to read as missing text instead of an overlapping icon.
                *
                * Reusing CategoryStrip's own margin trick here was not
                * straightforward: this container already carries `-mx-2
                * px-2 md:mx-0 md:px-0` for an unrelated reason (F-108
                * above — giving the 44px tap regions room inside an
                * overflow-x:auto ancestor without changing the visible
                * box). Adding `mr-9`/`ml-9` on top would have meant three
                * competing margin utilities on one element, one of them
                * inside a `md:` media block that wins at exactly the width
                * this bug was measured at.
                *
                * So the fix is layout, not spacing: the arrows are now
                * ordinary flex SIBLINGS of the scroll container, not
                * children stacked on top of it. `flex-1 min-w-0` on the
                * scroll container means its clientWidth is *already*
                * "whatever the row has left after the arrows" — there is
                * no separate reservation to keep in sync, and no tab can
                * ever render under a button because the button is never
                * over the scrollable area in the first place, at any
                * width, matching or not matching this file's existing
                * mx/px pair.
                */}
              <div className="mb-3 md:mb-6 flex items-center gap-1">
              {/*
                * `tap-44` on the arrow buttons — CI's "UI gate / Every
                * control reachable, nothing regressed" caught this, not a
                * manual pass: the painted box is `h-7 w-7` (28x28), flagged
                * on android-360/iphone-390/app-360 as "tap targets too
                * small". `.tap-44` grows the HIT region to 44x44 via an
                * out-of-flow `::after` (documented above `.tap-44` in
                * src/index.css) without moving a single pixel of the
                * visible 28x28 circle — same technique already used on
                * every TabsTrigger below. Symmetric growth is safe here
                * (unlike the F-109 case in index.css): these buttons have
                * clearance on every side, not text stacked directly above
                * or below them.
                */}
              {tabRowCanLeft && (
                <button
                  type="button"
                  onClick={() => nudgeTabRow(-1)}
                  aria-label={t("common.previous", "Previous")}
                  className="shrink-0 tap-44 flex h-7 w-7 items-center justify-center rounded-full border border-border bg-background text-foreground shadow-md hover:bg-muted"
                >
                  <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                </button>
              )}
              <div
                ref={tabRowRef}
                onScroll={measureTabRow}
                className="flex items-center min-h-[44px] min-w-0 flex-1 overflow-x-auto scrollbar-hide -mx-2 px-2 md:mx-0 md:px-0 py-[7px] -my-[7px]"
                style={{ WebkitOverflowScrolling: "touch" }}
              >
                {/*
                  * `shrink-0 justify-start` — WITHOUT THESE, "AWAITED" GOES
                  * MISSING WITH NO LEFT ARROW TO GET IT BACK.
                  *
                  * Owner, 2026-09-15, on the flex-sibling version: "Following"
                  * was fixed, but now "Awaited" was cut on the LEFT with no
                  * `Previous` button — and `tabRowCanLeft` was false, so this
                  * was not the scroll-position bug again. Measured live on
                  * staging: `scroller.scrollLeft` really was 0, yet the first
                  * tab's own rendered box started 23px to the LEFT of its
                  * parent TabsList's box (`getBoundingClientRect`, both read
                  * in the same tick). A child cannot render before its
                  * parent's edge from scrollLeft, margin, or position offset
                  * — all three were zero. It rendered there because TabsList
                  * itself was narrower than its content and centering it.
                  *
                  * TabsList's shared base (src/components/ui/tabs.tsx) sets
                  * `justify-center`, and nothing here ever cancelled it —
                  * invisible while TabsList had the room to be its natural
                  * `w-max` size. This row's scroll container is `flex`, and
                  * a flex item defaults to `flex-shrink: 1` unless told
                  * otherwise; TabsList carries no `shrink-0` of its own (only
                  * its individual TabsTriggers do), so when the container
                  * this row has to fit in got narrower — arrow buttons now
                  * take real space instead of overlaying, so there was LESS
                  * of it than before — the browser shrank TabsList below its
                  * content's width. The five triggers, each `shrink-0`,
                  * refused to shrink themselves, so they overflowed their
                  * now-too-narrow parent instead — and `justify-center`
                  * split that overflow evenly off BOTH edges. Confirmed live:
                  * forcing `justify-content: flex-start` on the real DOM
                  * dropped that 23px gap to exactly 0, nothing else touched.
                  *
                  * `shrink-0` is the actual fix — TabsList stays at its full
                  * content width, so nothing overflows IT and there is
                  * nothing for `justify-center` to redistribute; the row's
                  * own `overflow-x-auto` handles the excess as real,
                  * scrollable width instead of invisible centering-overflow.
                  * `justify-start` stays alongside it as a second line of
                  * defence, not because it fixes this alone — flip `shrink-0`
                  * off again by accident later and centering would still be
                  * quietly wrong instead of loudly.
                  */}
                <TabsList className="inline-flex shrink-0 justify-start gap-2 bg-transparent border-none p-0 h-auto w-max min-w-full md:min-w-0">
                <TabsTrigger value="awaited" className="shrink-0 tap-44 rounded-full border border-border bg-muted/30 px-3 py-1.5 text-[9px] md:text-[10px] tracking-[0.1em] uppercase gap-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:border-primary shadow-none" style={headingFont}>
                  <UserCheck className="h-3 w-3 shrink-0" /> Awaited ({receivedRequests.length})
                </TabsTrigger>
                {sentRequests.length > 0 && (
                  <TabsTrigger value="pending" className="shrink-0 tap-44 rounded-full border border-border bg-muted/30 px-3 py-1.5 text-[9px] md:text-[10px] tracking-[0.1em] uppercase gap-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:border-primary shadow-none" style={headingFont}>
                    <Clock className="h-3 w-3 shrink-0" /> {t("fr.pending")} ({sentRequests.length})
                  </TabsTrigger>
                )}
                <TabsTrigger value="friends" className="shrink-0 tap-44 rounded-full border border-border bg-muted/30 px-3 py-1.5 text-[9px] md:text-[10px] tracking-[0.1em] uppercase gap-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:border-primary shadow-none" style={headingFont}>
                  <Users className="h-3 w-3 shrink-0" /> {t("menu.friends")} ({friends.length})
                </TabsTrigger>
                <TabsTrigger value="followers" className="shrink-0 tap-44 rounded-full border border-border bg-muted/30 px-3 py-1.5 text-[9px] md:text-[10px] tracking-[0.1em] uppercase gap-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:border-primary shadow-none" style={headingFont}>
                  <Heart className="h-3 w-3 shrink-0" /> {t("fr.followers")} ({followers.length})
                </TabsTrigger>
                <TabsTrigger value="following" className="shrink-0 tap-44 rounded-full border border-border bg-muted/30 px-3 py-1.5 text-[9px] md:text-[10px] tracking-[0.1em] uppercase gap-1.5 data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:border-primary shadow-none" style={headingFont}>
                  <Heart className="h-3 w-3 shrink-0" /> {t("fr.followingTab")} ({following.length})
                </TabsTrigger>
                </TabsList>
              </div>
              {tabRowCanRight && (
                <button
                  type="button"
                  onClick={() => nudgeTabRow(1)}
                  aria-label={t("common.next", "Next")}
                  className="shrink-0 tap-44 flex h-7 w-7 items-center justify-center rounded-full border border-border bg-background text-foreground shadow-md hover:bg-muted"
                >
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                </button>
              )}
              </div>

              {/* Awaited — requests RECEIVED, accept one by one */}
              <TabsContent value="awaited">
                {receivedRequests.filter((r) => filterBySearch(r.profile)).length > 0 ? (
                  <div className="border border-border divide-y divide-border">
                    {receivedRequests.filter((r) => filterBySearch(r.profile)).map((req) => (
                      <PersonRow
                        key={req.friendshipId}
                        profile={req.profile}
                        badges={badgeMap.get(req.profile.id) || []}
                        mutualCount={mutualCounts.get(req.profile.id)}
                        mutualFriends={mutualProfiles.get(req.profile.id)}
                        subtitle={t("fr.wantsToBe")}
                        date={formatDate(req.since)}
                        actions={
                          <div className="flex gap-2">
                            <ActionBtn
                              icon={<UserCheck className="h-3 w-3" />}
                              label={t("dash.accept")}
                              onClick={() => acceptRequest(req.friendshipId, req.profile.id)}
                              disabled={actionLoading === req.friendshipId}
                              variant="primary"
                            />
                            <ActionBtn
                              icon={<UserX className="h-3 w-3" />}
                              label={t("dash.decline")}
                              onClick={() => declineRequest(req.friendshipId)}
                              disabled={actionLoading === req.friendshipId}
                              variant="muted"
                            />
                          </div>
                        }
                      />
                    ))}
                  </div>
                ) : (
                  <EmptyState message="No friend requests waiting for you right now." />
                )}
              </TabsContent>

              {/* Pending — requests I SENT */}
              {sentRequests.length > 0 && (
                <TabsContent value="pending">
                  <div className="border border-border divide-y divide-border">
                    {sentRequests.filter((r) => filterBySearch(r.profile)).map((req) => (
                      <PersonRow
                        key={req.friendshipId}
                        profile={req.profile}
                        badges={badgeMap.get(req.profile.id) || []}
                        mutualCount={mutualCounts.get(req.profile.id)}
                        mutualFriends={mutualProfiles.get(req.profile.id)}
                        subtitle={t("fr.requestSent")}
                        date={formatDate(req.since)}
                        actions={
                          <ActionBtn
                            icon={<UserX className="h-3 w-3" />}
                            label={t("common.cancel")}
                            onClick={() => declineRequest(req.friendshipId)}
                            disabled={actionLoading === req.friendshipId}
                            variant="muted"
                          />
                        }
                      />
                    ))}
                  </div>
                  {sentRequests.filter((r) => filterBySearch(r.profile)).length === 0 && (
                    <EmptyState message={t("fr.noMatchingPending")} />
                  )}
                </TabsContent>
              )}

              {/* Friends */}
              <TabsContent value="friends">
                {friends.filter((f) => filterBySearch(f.profile)).length > 0 ? (
                  <div className="border border-border divide-y divide-border">
                    {friends.filter((f) => filterBySearch(f.profile)).map((f) => (
                      <PersonRow
                        key={f.friendshipId}
                        profile={f.profile}
                        badges={badgeMap.get(f.profile.id) || []}
                        mutualCount={mutualCounts.get(f.profile.id)}
                        mutualFriends={mutualProfiles.get(f.profile.id)}
                        subtitle={f.profile.city && f.profile.country ? `${f.profile.city}, ${f.profile.country}` : f.profile.bio?.slice(0, 60) || null}
                        date={`${t("fr.friendsSince")} ${formatDate(f.since)}`}
                        actions={
                          <ActionBtn
                            icon={<UserMinus className="h-3 w-3" />}
                            label={t("fr.remove")}
                            onClick={() => removeFriend(f.friendshipId)}
                            disabled={actionLoading === f.friendshipId}
                            variant="danger"
                          />
                        }
                      />
                    ))}
                  </div>
                ) : (
                  <EmptyState message={search ? t("fr.noFriendsMatch") : t("fr.noFriendsYet")} />
                )}
              </TabsContent>

              {/* Followers */}
              <TabsContent value="followers">
                {followers.filter((f) => filterBySearch(f.profile)).length > 0 ? (
                  <div className="border border-border divide-y divide-border">
                    {followers.filter((f) => filterBySearch(f.profile)).map((f) => (
                      <PersonRow
                        key={f.id}
                        profile={f.profile}
                        badges={badgeMap.get(f.profile.id) || []}
                        mutualCount={mutualCounts.get(f.profile.id)}
                        mutualFriends={mutualProfiles.get(f.profile.id)}
                        subtitle={f.profile.city && f.profile.country ? `${f.profile.city}, ${f.profile.country}` : null}
                        date={`${t("fr.followingSince")} ${formatDate(f.since)}`}
                        actions={null}
                      />
                    ))}
                  </div>
                ) : (
                  <EmptyState message={search ? t("fr.noFollowersMatch") : t("fr.noFollowersYet")} />
                )}
              </TabsContent>

              {/* Following */}
              <TabsContent value="following">
                {following.filter((f) => filterBySearch(f.profile)).length > 0 ? (
                  <div className="border border-border divide-y divide-border">
                    {following.filter((f) => filterBySearch(f.profile)).map((f) => (
                      <PersonRow
                        key={f.id}
                        profile={f.profile}
                        badges={badgeMap.get(f.profile.id) || []}
                        mutualCount={mutualCounts.get(f.profile.id)}
                        mutualFriends={mutualProfiles.get(f.profile.id)}
                        subtitle={f.profile.city && f.profile.country ? `${f.profile.city}, ${f.profile.country}` : null}
                        date={`Since ${formatDate(f.since)}`}
                        actions={
                          <ActionBtn
                            icon={<Heart className="h-3 w-3" />}
                            label={t("fr.unfollow")}
                            onClick={() => unfollow(f.id, f.profile.id)}
                            disabled={actionLoading === f.id}
                            variant="muted"
                          />
                        }
                      />
                    ))}
                  </div>
                ) : (
                  <EmptyState message={search ? t("fr.noFollowingMatch") : t("fr.noFollowingYet")} />
                )}
              </TabsContent>
            </Tabs>
          </motion.div>
        </motion.div>
      </div>
    </main>
  );
};

/* ─── Sub-components ─── */

const PersonRow = ({ profile, badges, subtitle, date, actions, mutualCount, mutualFriends }: {
  profile: FriendProfile;
  badges: string[];
  subtitle: string | null;
  date: string;
  actions: React.ReactNode;
  mutualCount?: number;
  mutualFriends?: { id: string; full_name: string | null; avatar_url: string | null; custom_url: string | null }[];
}) => {
  const t = useT();
  const name = profile.full_name || "Unknown User";
  const initials = name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2);
  const online = isActiveNow(profile.last_active_at);

  return (
    <div className="flex gap-3 p-3 md:p-5">
      <ProfileLink userId={profile.id} handle={profile.custom_url} className="shrink-0 mt-0.5 relative">
        {profile.avatar_url ? (
          <img referrerPolicy="no-referrer" loading="lazy" decoding="async" src={profile.avatar_url} alt={name} className={`w-11 h-11 rounded-full object-cover ${online ? "ring-2 ring-green-500 ring-offset-2 ring-offset-background" : ""}`} />
        ) : (
          <div className={`w-11 h-11 rounded-full bg-primary/10 flex items-center justify-center ${online ? "ring-2 ring-green-500 ring-offset-2 ring-offset-background" : ""}`}>
            <span className="text-sm font-light text-primary" style={{ fontFamily: "var(--font-display)" }}>{initials}</span>
          </div>
        )}
        {/* Presence dot on the avatar (green = online, gray = offline) */}
        <span
          className={`absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-background ${
            online ? "bg-green-500" : "bg-muted-foreground/30"
          }`}
        />
      </ProfileLink>
      <div className="flex-1 min-w-0">
        {/* Top row: name + date */}
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <UserIdentityBlock
              userId={profile.id}
              name={name}
              handle={profile.custom_url}
              nameClassName="text-sm font-light hover:text-primary transition-colors duration-300 break-words [font-family:var(--font-heading)]"
            />
          </div>
          <span className="text-[8px] text-muted-foreground shrink-0 mt-0.5 whitespace-nowrap" style={{ fontFamily: "var(--font-body)" }}>
            {date}
          </span>
        </div>
        {mutualCount != null && mutualCount > 0 && (
          <div className="flex items-center gap-1.5 mt-0.5">
            {/* Real avatars of mutual friends */}
            <div className="flex -space-x-1.5">
              {(mutualFriends || []).slice(0, 3).map((m) => (
                <ProfileLink key={m.id} userId={m.id} handle={m.custom_url} className="relative z-[1] hover:z-10 transition-transform hover:scale-110">
                  {m.avatar_url ? (
                    <img loading="lazy" decoding="async"
                      src={m.avatar_url}
                      alt={m.full_name || ""}
                      className="h-5 w-5 rounded-full border-2 border-background object-cover"
                    />
                  ) : (
                    <div className="h-5 w-5 rounded-full border-2 border-background bg-muted flex items-center justify-center">
                      <span className="text-[7px] font-semibold text-muted-foreground">
                        {(m.full_name || "?")[0]?.toUpperCase()}
                      </span>
                    </div>
                  )}
                </ProfileLink>
              ))}
            </div>
            <span className="text-[10px] text-muted-foreground" style={headingFont}>
              {mutualCount} {t("fr.mutualFriends")}
              {mutualFriends && mutualFriends.length > 0 && (
                <> {t("fr.including")}{" "}
                  <ProfileLink userId={mutualFriends[0].id} handle={mutualFriends[0].custom_url} className="text-foreground font-medium hover:text-primary transition-colors">
                    {mutualFriends[0].full_name || "a friend"}
                  </ProfileLink>
                  {mutualCount > 1 && mutualFriends.length > 1 && (
                    <> and{" "}
                      <ProfileLink userId={mutualFriends[1].id} handle={mutualFriends[1].custom_url} className="text-foreground font-medium hover:text-primary transition-colors">
                        {mutualFriends[1].full_name || "others"}
                      </ProfileLink>
                    </>
                  )}
                </>
              )}
            </span>
          </div>
        )}
        {subtitle && (
          <p className="text-[10px] text-muted-foreground truncate mt-0.5" style={{ fontFamily: "var(--font-body)" }}>
            {subtitle}
          </p>
        )}
        {/* Presence: bold green "Online" when active, else muted last-seen */}
        {online ? (
          <p className="text-[10px] mt-0.5 font-medium text-green-600 dark:text-green-400 flex items-center gap-1" style={{ fontFamily: "var(--font-body)" }}>
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse" />
            Online
          </p>
        ) : profile.last_active_at ? (
          <p className="text-[9px] mt-0.5 text-muted-foreground/60" style={{ fontFamily: "var(--font-body)" }}>
            {formatLastSeen(profile.last_active_at)}
          </p>
        ) : null}
        {/* Action buttons below */}
        {actions && (
          <div className="mt-2 flex items-center gap-2">{actions}</div>
        )}
      </div>
    </div>
  );
};

const ActionBtn = ({ icon, label, onClick, disabled, variant }: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled: boolean;
  variant: "primary" | "danger" | "muted";
}) => {
  const styles = {
    primary: "border-primary/50 text-primary hover:bg-primary hover:text-primary-foreground",
    danger: "border-destructive/30 text-destructive hover:bg-destructive hover:text-destructive-foreground",
    muted: "border-border text-muted-foreground hover:border-foreground hover:text-foreground",
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1.5 text-[10px] tracking-[0.1em] uppercase px-3 py-1.5 border transition-all duration-300 disabled:opacity-50 ${styles[variant]}`}
      style={{ fontFamily: "var(--font-heading)" }}
    >
      {icon}
      {label}
    </button>
  );
};

const EmptyState = ({ message }: { message: string }) => (
  <div className="border border-dashed border-border p-10 text-center">
    <Users className="h-8 w-8 text-muted-foreground/30 mx-auto mb-3" />
    <p className="text-xs text-muted-foreground" style={{ fontFamily: "var(--font-body)" }}>
      {message}
    </p>
  </div>
);

export default Friends;
