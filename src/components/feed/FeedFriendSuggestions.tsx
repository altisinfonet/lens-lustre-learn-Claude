import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { UserPlus, X, Check, ChevronLeft, ChevronRight } from "lucide-react";
import ProfileLink from "@/components/ProfileLink";
import UserIdentityBlock from "@/components/UserIdentityBlock";
import { useDashboardContext } from "@/hooks/core/DashboardContext";
import { useSendFriendRequest } from "@/hooks/social/useFriendshipMutations";
import { getAdminIds } from "@/lib/adminBrand";
import { isNativeCapacitorApp } from "@/lib/native/authDeepLink";
import { useT } from "@/i18n/I18nContext";

/**
 * FRIEND SUGGESTIONS, INSIDE THE FEED — APP ONLY.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Owner request, 2026-08-04, with an Instagram screenshot for reference:
 * "friend suggestion will show only in App … after 10 feed posts show this kind
 *  of left to right scrolled for friend suggestion."
 *
 * WHY THIS EXISTS AT ALL: suggestions have always been in the RIGHT SIDEBAR,
 * and that sidebar is `hidden xl:block` — desktop web only. So a member using
 * the installed app has never been shown a single suggestion. This is not a
 * duplicate of the sidebar; it is the only place app users get one.
 *
 * APP ONLY, deliberately. On web the sidebar already shows these, and putting
 * the same faces in the middle of the feed as well would be repetition. The
 * component returns null on web rather than being conditionally rendered by the
 * caller, so the rule lives in one place and a future caller cannot get it
 * wrong.
 *
 * NO NEW NETWORK CALL: the rows come from `useDashboardContext()`, the same
 * single bootstrap payload the sidebar reads. Adding a fetch here would have
 * put a request in the middle of the feed scroll — see PERFORMANCE_AUDIT.md,
 * where the feed was cut from 106 requests to 46 precisely by removing
 * duplicate reads like that.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** How many cards to render. Enough to scroll, not enough to feel like a wall. */
const MAX_CARDS = 12;

/** Card width (132) + the gap between cards (gap-2.5 = 10px). One tap = one card. */
const CARD_STEP = 142;

/**
 * A few pixels of slack before "there is more this way" turns off. Browsers
 * report fractional scroll offsets, so `scrollLeft + clientWidth === scrollWidth`
 * is almost never exactly true at the end of a rail — without this the right
 * arrow would stay lit forever on some devices.
 */
const EDGE_SLACK = 4;

const FeedFriendSuggestions = () => {
  const t = useT();
  const { sidebarData } = useDashboardContext();
  const sendRequest = useSendFriendRequest();
  /** Locally hidden cards: the X, and anyone already actioned this session. */
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [sent, setSent] = useState<Set<string>>(new Set());

  /**
   * `getAdminIds()` is async (one memoised call for the whole session), so the
   * set arrives a tick later — same pattern the sidebar uses. Until it does,
   * `adminIds` is empty, which is safe: the DB trigger refuses a friend request
   * to the official account regardless, and the mutation shows the follow-only
   * message. This filter is the third layer, not the only one.
   */
  const [adminIds, setAdminIds] = useState<Set<string>>(new Set());
  const rawSuggestions = (sidebarData?.suggestions ?? []) as any[];

  useEffect(() => {
    if (rawSuggestions.length === 0) return;
    let cancelled = false;
    (async () => {
      const admins = await getAdminIds();
      if (cancelled) return;
      setAdminIds(new Set(rawSuggestions.filter((s: any) => admins.has(s.id)).map((s: any) => s.id)));
    })();
    return () => { cancelled = true; };
  }, [rawSuggestions]);

  const people = useMemo(() => {
    const raw = rawSuggestions;
    return raw
      // The official account is follow-only by standing owner policy, so an
      // "Add friend" card for it would be an action that can only ever fail.
      .filter((s) => !adminIds.has(s.id))
      .filter((s) => !dismissed.has(s.id))
      .slice(0, MAX_CARDS);
  }, [rawSuggestions, adminIds, dismissed]);

  /**
   * ARROWS — "a small arrow will make the user understand that there is more."
   * Owner instruction, 2026-08-04, after seeing the first render: a rail that
   * scrolls but shows no affordance reads as a row that simply ends.
   *
   * `canLeft` / `canRight` are measured from the rail's own scroll geometry, not
   * guessed from the number of cards — on a wide phone all the cards may already
   * fit, and an arrow pointing at nothing is worse than no arrow. Both start
   * false and are set by the first measurement, so nothing flashes on mount.
   */
  const railRef = useRef<HTMLDivElement | null>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const measure = useCallback(() => {
    const el = railRef.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > EDGE_SLACK);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - EDGE_SLACK);
  }, []);

  /**
   * useLayoutEffect, so the first measurement happens before paint: the right
   * arrow is there on the very first frame the rail is visible, never a beat
   * later. ResizeObserver covers rotation and the keyboard opening/closing.
   */
  useLayoutEffect(() => {
    const el = railRef.current;
    if (!el) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure, people.length]);

  const nudge = (dir: -1 | 1) => {
    railRef.current?.scrollBy({ left: dir * CARD_STEP, behavior: "smooth" });
  };

  // Web: the sidebar already covers this. Nothing to render.
  if (!isNativeCapacitorApp()) return null;
  // Never render an empty shell — a header with no cards is worse than nothing.
  if (people.length === 0) return null;

  return (
    <section
      // Full width, one hairline, no box. Owner, 2026-08-10: "I told No border
      // anything to anywhere, example like Instagram". This block sat inside
      // `.container`'s 90% width with its own border and radius, so it was one
      // of the inset panels in his screenshot while the posts around it ran to
      // both edges. `bleed-phone` matches PostCard exactly.
      className="bleed-phone overflow-hidden mb-4"
      aria-label={t("sidebar.peopleYouMayKnow", "People you may know")}
    >
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <div className="min-w-0">
          <h2
            className="text-xs font-semibold text-foreground"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            {t("sidebar.peopleYouMayKnow", "People you may know")}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5" style={{ fontFamily: "var(--font-body)" }}>
            {t("feedSuggest.subtitle", "Photographers you might want to connect with")}
          </p>
        </div>
        <Link
          to="/discover"
          className="shrink-0 text-[9px] tracking-[0.15em] uppercase text-primary hover:underline"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          {t("sidebar.seeAll", "See all")}
        </Link>
      </div>

      {/*
        The horizontal rail. `snap-x` so a thumb-flick lands on a card edge
        instead of halfway through one, and `scrollbar-hide` because a visible
        scrollbar under a row of cards looks like a mistake on a phone.
        `overscroll-x-contain` stops a sideways swipe from also dragging the
        page behind it.
      */}
      <div className="relative">
      <div
        ref={railRef}
        onScroll={measure}
        /*
          `scroll-px-4` matches `px-4`. Without it, snap-mandatory pulls the
          first card flush against the left edge on load — measured scrollLeft
          16 at rest — which both eats the inset AND lights the "there is more
          to the left" arrow while sitting at the very start.
        */
        className="flex gap-2.5 overflow-x-auto overscroll-x-contain snap-x snap-mandatory scroll-px-4 scrollbar-hide px-4 pb-4 pt-1"
      >
        {people.map((s: any) => {
          const isSent = sent.has(s.id);
          return (
            <div
              key={s.id}
              className="relative snap-start shrink-0 w-[132px] border border-border bg-background/40 p-3 pt-4 flex flex-col items-center text-center"
            >
              <button
                type="button"
                onClick={() => setDismissed((prev) => new Set(prev).add(s.id))}
                aria-label={t("feedSuggest.dismiss", "Not interested")}
                /* 28px target in the corner — small on screen, still hittable. */
                className="absolute right-0.5 top-0.5 flex h-7 w-7 items-center justify-center text-muted-foreground/70 hover:text-foreground transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>

              <ProfileLink userId={s.id} handle={s.custom_url} className="shrink-0">
                {s.avatar_url ? (
                  <img
                    referrerPolicy="no-referrer"
                    loading="lazy"
                    decoding="async"
                    src={s.avatar_url}
                    alt=""
                    className="h-16 w-16 rounded-full object-cover"
                  />
                ) : (
                  <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
                    <span className="text-lg text-primary" style={{ fontFamily: "var(--font-display)" }}>
                      {(s.full_name || "?")[0]?.toUpperCase()}
                    </span>
                  </div>
                )}
              </ProfileLink>

              {/* Same identity block as everywhere else, so badges and the
                  name-outranks-badge rule apply here too without restating them.

                  `stack` puts the badge on its own line: this card is 132px
                  wide, and inline the badge would be squeezed to nothing beside
                  the name — a card with a name and no badge. The standing rule
                  is that the badge shows wherever the name shows. */}
              <div className="mt-2 w-full flex justify-center">
                <UserIdentityBlock
                  userId={s.id}
                  name={s.full_name || "Photographer"}
                  handle={s.custom_url}
                  stack
                  align="center"
                  nameClassName="text-[11px] font-semibold text-foreground hover:text-primary transition-colors"
                />
              </div>

              <p className="mt-0.5 text-[9px] text-muted-foreground truncate w-full" style={{ fontFamily: "var(--font-body)" }}>
                {s.mutual_count > 0
                  ? `${s.mutual_count} ${s.mutual_count === 1 ? t("feedSuggest.mutual", "mutual friend") : t("feedSuggest.mutuals", "mutual friends")}`
                  : t("feedSuggest.suggested", "Suggested for you")}
              </p>

              <button
                type="button"
                disabled={isSent || sendRequest.isPending}
                onClick={() => {
                  // Optimistic on THIS card only. The mutation owns the policy
                  // (official account is follow-only) and the friendly wording
                  // for an already-sent request — see useFriendshipMutations.
                  setSent((prev) => new Set(prev).add(s.id));
                  sendRequest.mutate(s.id, {
                    onError: () =>
                      setSent((prev) => {
                        const next = new Set(prev);
                        next.delete(s.id);
                        return next;
                      }),
                  });
                }}
                className={`mt-2.5 w-full inline-flex items-center justify-center gap-1 rounded-sm px-2 py-1.5 text-[9px] tracking-[0.15em] uppercase transition-all disabled:cursor-default ${
                  isSent
                    ? "border border-border text-muted-foreground"
                    : "bg-primary text-primary-foreground hover:bg-primary/90"
                }`}
                style={{ fontFamily: "var(--font-heading)" }}
              >
                {isSent ? (
                  <>
                    <Check className="h-3 w-3" /> {t("feedSuggest.sent", "Sent")}
                  </>
                ) : (
                  <>
                    <UserPlus className="h-3 w-3" /> {t("feedSuggest.add", "Add")}
                  </>
                )}
              </button>
            </div>
          );
        })}
      </div>

        {/*
          The arrows sit OVER the rail, not in the flow, so turning one on or off
          never shifts a card by a pixel. `pointer-events-none` on the hidden
          state would still swallow a swipe, so they are unmounted instead.

          A soft fade of the card background runs under each arrow: it is the fade
          that says "this row continues", the chevron just names the direction.
        */}
        {canLeft && (
          <>
            <div className="pointer-events-none absolute left-0 top-0 bottom-4 w-10 bg-gradient-to-r from-card to-transparent" />
            <button
              type="button"
              onClick={() => nudge(-1)}
              aria-label={t("feedSuggest.prev", "Previous")}
              className="absolute left-1 top-[52px] -translate-y-1/2 flex h-7 w-7 items-center justify-center rounded-full border border-border bg-background/95 text-foreground shadow-sm active:scale-95 transition-transform"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
          </>
        )}
        {canRight && (
          <>
            <div className="pointer-events-none absolute right-0 top-0 bottom-4 w-10 bg-gradient-to-l from-card to-transparent" />
            <button
              type="button"
              onClick={() => nudge(1)}
              aria-label={t("feedSuggest.next", "Next")}
              className="absolute right-1 top-[52px] -translate-y-1/2 flex h-7 w-7 items-center justify-center rounded-full border border-border bg-background/95 text-foreground shadow-sm active:scale-95 transition-transform"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </>
        )}
      </div>
    </section>
  );
};

export default FeedFriendSuggestions;
