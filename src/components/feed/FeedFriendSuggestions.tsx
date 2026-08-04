import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { UserPlus, X, Check } from "lucide-react";
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

  // Web: the sidebar already covers this. Nothing to render.
  if (!isNativeCapacitorApp()) return null;
  // Never render an empty shell — a header with no cards is worse than nothing.
  if (people.length === 0) return null;

  return (
    <section
      className="mb-4 border border-border bg-card/50 rounded-sm overflow-hidden"
      aria-label={t("sidebar.peopleYouMayKnow", "People you may know")}
    >
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <div className="min-w-0">
          <h2
            className="text-[9px] tracking-[0.3em] uppercase text-primary"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            {t("sidebar.peopleYouMayKnow", "People you may know")}
          </h2>
          <p className="text-[10px] text-muted-foreground mt-0.5" style={{ fontFamily: "var(--font-body)" }}>
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
      <div className="flex gap-2.5 overflow-x-auto overscroll-x-contain snap-x snap-mandatory scrollbar-hide px-4 pb-4 pt-1">
        {people.map((s: any) => {
          const isSent = sent.has(s.id);
          return (
            <div
              key={s.id}
              className="relative snap-start shrink-0 w-[132px] rounded-sm border border-border bg-background/40 p-3 pt-4 flex flex-col items-center text-center"
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

              <ProfileLink userId={s.id} className="shrink-0">
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
                  name-outranks-badge rule apply here too without restating them. */}
              <div className="mt-2 w-full flex justify-center">
                <UserIdentityBlock
                  userId={s.id}
                  name={s.full_name || "Photographer"}
                  linkTo={`/profile/${s.id}`}
                  nameClassName="text-[11px] font-semibold text-foreground truncate hover:text-primary transition-colors"
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
    </section>
  );
};

export default FeedFriendSuggestions;
