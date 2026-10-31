/**
 * /notifications — the full notification screen.
 *
 * Replaces nothing: the bell dropdown stays as it is (an unread inbox feeding
 * the badge). This is the history, grouped server-side by
 * get_my_notifications_grouped().
 *
 * Deliberate choice: paging is a BUTTON, not a scroll listener. This page exists
 * because a scroll listener closed the notification panel under the user's
 * finger (fixed 2026-08-01, see NotificationBellScroll.test.tsx). Adding a fresh
 * scroll listener to the replacement screen would be a poor trade for saving one
 * tap.
 */
import { useMemo, useState } from "react";
import ActorPhrase from "@/components/notifications/ActorPhrase";
import { useCentreUi } from "@/lib/notifications/centreUi";
import { NOTIFICATION_TABS, TAB_LABEL, inTab, type NotificationTab } from "@/lib/notifications/tabs";
import { useMemberHandles } from "@/hooks/profile/useMemberHandles";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Bell, X } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/core/useAuth";
import { useT } from "@/i18n/I18nContext";
import { useToggleFollow } from "@/hooks/social/useFriendshipMutations";
import { getNotifLink } from "@/lib/notificationLinks";
import { goBackOrFeed, notificationEntryState } from "@/lib/navigationContract";
import { inAppHistoryDepth } from "@/hooks/core/useAndroidBackButton";
import { queryKeys } from "@/lib/queryKeys";
import {
  useNotificationHistory,
  useFollowingSet,
  markGroupRead,
  deleteGroup,
} from "@/hooks/notifications/useNotificationHistory";
import {
  bucketFor,
  BUCKET_LABEL,
  type NotificationGroup,
  type BucketKey,
} from "@/lib/notificationText";
// The sentence itself comes from the shared layer, NOT from this page. The bell
// composes from the same function, so the two surfaces cannot drift apart
// again — see src/lib/notifications/describe.ts for the naming rules.
import { describeNotification, actorDisplayName } from "@/lib/notifications/describe";
import { subjectFromGroup } from "@/lib/notifications/adapters";
import { useAdminIds } from "@/hooks/core/useAdminIds";
import { isNativeIOSApp } from "@/lib/native/authDeepLink";
import { isWalletNotificationType } from "@/lib/native/iosReview";
import VideoPoster from "@/components/video/VideoPoster";
import { postMedia } from "@/lib/posts/subjectMedia";
import { fetchPostVideoMap, type FeedVideo } from "@/lib/video/postVideoRead";
import { useNetworkQuality } from "@/hooks/core/useNetworkQuality";
import { screenState } from "@/lib/offline/screenState";

const headingFont = { fontFamily: "var(--font-heading)" };
const bodyFont = { fontFamily: "var(--font-body)" };
const BUCKET_ORDER: BucketKey[] = ["new", "last30", "earlier"];

function Avatar({ url, alt }: { url?: string; alt: string }) {
  if (!url) {
    return (
      <div className="w-11 h-11 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
        <Bell className="h-4 w-4 text-primary" />
      </div>
    );
  }
  return (
    <img
      src={url}
      alt={alt}
      referrerPolicy="no-referrer"
      loading="lazy"
      decoding="async"
      className="w-11 h-11 rounded-full object-cover shrink-0"
    />
  );
}

/** The post's picture for a row: its video's poster, else its photograph. */
function RowThumb({ media }: { media: ReturnType<typeof postMedia> }) {
  return media.video ? (
    <VideoPoster video={media.video} />
  ) : (
    <img
      src={media.imageUrls[0]}
      alt=""
      referrerPolicy="no-referrer"
      loading="lazy"
      decoding="async"
      className="w-11 h-14 object-cover rounded-sm"
    />
  );
}

function NotificationRow({
  group,
  isFollowing,
  followReady,
  onOpen,
  onFollowBack,
  onDelete,
  followPending,
  adminIds,
  video,
  centreRows = false,
}: {
  group: NotificationGroup;
  /** N7 (site_settings notif_centre_ui): one control per row, plain bold names, unread dot. */
  centreRows?: boolean;
  /** BUG-VID-HOME: the post's playable video when the notification is about a video post (one batched read for the list). */
  video: FeedVideo | null;
  isFollowing: boolean;
  followReady: boolean;
  onOpen: (g: NotificationGroup) => void;
  onFollowBack: (actorId: string) => void;
  onDelete: (g: NotificationGroup) => void;
  followPending: boolean;
  /** Passed down rather than fetched per row — one lookup for the whole list. */
  adminIds: Set<string>;
}) {
  const t = useT();
  const unread = (group.unread_count ?? 0) > 0;
  const actorId = group.actor_ids?.[0];
  const subject = subjectFromGroup(group, adminIds);
  const described = describeNotification(subject);
  const media = postMedia({ video, image_url: group.thumbnail_url });

  // Only offer Follow back when we KNOW they are not already followed.
  // Unknown state must disable the action, never enable it (§0).
  const showFollowBack =
    group.type === "new_follower" && !!actorId && followReady && !isFollowing;

  if (centreRows) {
    return (
      <div
        className={`flex items-center gap-3 px-4 py-3 border-b border-border/50 transition-colors ${
          unread ? "bg-primary/5" : ""
        } hover:bg-muted/20`}
      >
        <button
          data-notif-row-open="true"
          onClick={() => onOpen(group)}
          className="flex items-center gap-3 flex-1 min-w-0 text-left rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="relative shrink-0">
            <Avatar url={group.actor_avatars?.[0] || undefined} alt="" />
            {unread && (
              <span
                data-notif-unread-dot="true"
                aria-hidden="true"
                className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-background"
              />
            )}
          </span>
          <span className="text-xs leading-relaxed text-foreground min-w-0 flex-1" style={bodyFont}>
            {/* The accessible name IS the visible text (WCAG 2.5.3); the
                unread state is spoken first, the dot is decoration. */}
            {unread && <span className="sr-only">{t("notifications.unread", "Unread")}, </span>}
            {described.hasActor ? (
              <>
                <ActorPhrase subject={subject} plain /> {described.action}
              </>
            ) : (
              described.text
            )}{" "}
            <span className="text-muted-foreground">{described.age}</span>
          </span>
          {(media.video || media.imageUrls[0]) && (
            <span className="shrink-0 relative w-11 h-14 overflow-hidden rounded-sm">
              <RowThumb media={media} />
            </span>
          )}
        </button>

        {showFollowBack && (
          <button
            onClick={() => onFollowBack(actorId!)}
            disabled={followPending}
            className="shrink-0 px-3 py-1.5 tap-44 rounded-md bg-primary text-primary-foreground text-[11px] font-semibold disabled:opacity-50"
            style={headingFont}
          >
            {t("notifications.follow_back", "Follow back")}
          </button>
        )}

        <button
          onClick={() => onDelete(group)}
          aria-label={t("notifications.delete", "Delete")}
          title={t("notifications.delete", "Delete")}
          className="shrink-0 h-7 w-7 tap-44 rounded-full flex items-center justify-center text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10 transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 border-b border-border/50 transition-colors ${
        unread ? "bg-primary/5" : ""
      } hover:bg-muted/20`}
    >
      <button
        onClick={() => onOpen(group)}
        className="flex items-center gap-3 flex-1 min-w-0 text-left"
      >
        <Avatar url={group.actor_avatars?.[0] || undefined} alt={actorDisplayName(subject.actors[0])} />
        <span className="text-xs leading-relaxed text-foreground min-w-0" style={bodyFont}>
          {described.hasActor ? (
            <>
              <span className="font-semibold"><ActorPhrase subject={subject} /></span> {described.action}
            </>
          ) : (
            described.text
          )}{" "}
          <span className="text-muted-foreground">{described.age}</span>
        </span>
      </button>

      {showFollowBack && (
        <button
          onClick={() => onFollowBack(actorId!)}
          disabled={followPending}
          /*
           * F-103 — Follow back. 92.8 x 29.4 at desktop, 92.7 x 29.4 at 360px:
           * wide enough, fifteen pixels short in height, and the two readings
           * agree so it is not a viewport artefact. Raw button — see Back.
           */
          className="shrink-0 px-3 py-1.5 tap-44 rounded-md bg-primary text-primary-foreground text-[11px] font-semibold disabled:opacity-50"
          style={headingFont}
        >
          {t("notifications.follow_back", "Follow back")}
        </button>
      )}

      {/* The post's picture: its video's poster for a video post, else its
          photograph — decided by subjectMedia.ts, as on every other surface. */}
      {(media.video || media.imageUrls[0]) && (
        <button onClick={() => onOpen(group)} className="shrink-0 relative w-11 h-14 overflow-hidden rounded-sm">
          <RowThumb media={media} />
        </button>
      )}

      {/* Remove this line for good. Separate from opening it, and separate
          from the bell's X, which means "mark read". Deleting has no undo, so
          it never shares a control with something that does. */}
      <button
        onClick={() => onDelete(group)}
        aria-label={t("notifications.delete", "Delete")}
        title={t("notifications.delete", "Delete")}
        /*
         * F-103 — Delete, and there is one on EVERY ROW, so the Owner meets it
         * four times on the page measured. 28x28, agreed to the decimal by two
         * independent readings. The painted circle stays h-7 w-7; only the hit
         * area grows. Raw button — see the note on Back.
         */
        className="shrink-0 h-7 w-7 tap-44 rounded-full flex items-center justify-center text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10 transition-colors"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

const Notifications = () => {
  const t = useT();
  const navigate = useNavigate();
  // One admin lookup for the whole list, not one per row.
  const adminIds = useAdminIds();
  const { user } = useAuth();
  // N7 · notification centre rows, behind site_settings notif_centre_ui (OFF on live).
  const centreRows = useCentreUi(user?.id);
  // N7 tabs exist only with the centre rows; with the switch off the list is unchanged.
  const [tab, setTab] = useState<NotificationTab>("all");
  const activeTab: NotificationTab = centreRows ? tab : "all";
  const queryClient = useQueryClient();
  const followMutation = useToggleFollow();
  const [busyActor, setBusyActor] = useState<string | null>(null);

  const { data, isLoading, isError, error: historyError, fetchStatus, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useNotificationHistory();
  // S7b-4: saved notifications show with no network; with none saved, say
  // "no internet" — never "Nothing here yet" or a load error.
  const netState = useNetworkQuality();
  const screen = screenState({
    hasData: !!data, loading: isLoading, error: historyError,
    online: netState.online, paused: fetchStatus === "paused",
  });

  const groups = useMemo<NotificationGroup[]>(
    // App Store 3.1.1: no wallet notifications in the iOS app (same rule as the bell).
    () => (data?.pages ?? []).flat().filter((g) => !(isNativeIOSApp() && isWalletNotificationType(g.type))),
    [data],
  );

  /*
   * F-95 — handles for the notification types whose destination is a PERSON
   * (new_follower, friend_accepted). ONE batched lookup for the whole list,
   * never one per row. Their reference_id is the member.
   */
  const notifHandles = useMemberHandles(
    groups
      .filter((g) => g.type === "new_follower" || g.type === "friend_accepted")
      .map((g) => g.reference_id),
  );

  /*
   * BUG-VID-HOME — a notification about a VIDEO post had no thumbnail: the
   * server's thumbnail_url is the post's photograph, and a video post has
   * none. ONE batched read (the sanctioned post_videos read, through RLS) for
   * the rows that have a reference but no photograph; a reference that is not
   * a post simply finds nothing. A video this viewer may not play ("hidden")
   * shows no thumbnail.
   */
  const videoRefIds = useMemo(
    () => [...new Set(groups.filter((g) => g.reference_id && !g.thumbnail_url).map((g) => g.reference_id as string))].sort(),
    [groups],
  );
  const { data: postVideos } = useQuery({
    queryKey: ["notification-post-videos", videoRefIds.join(",")],
    queryFn: () => fetchPostVideoMap(videoRefIds),
    enabled: videoRefIds.length > 0,
    staleTime: 5 * 60_000,
  });
  const videoFor = (g: NotificationGroup): FeedVideo | null => {
    const v = g.reference_id ? postVideos?.get(g.reference_id) : undefined;
    return v && v !== "hidden" ? v : null;
  };

  const { following, ready: followReady } = useFollowingSet(
    useMemo(
      () => groups.filter((g) => g.type === "new_follower").map((g) => g.actor_ids?.[0]).filter(Boolean) as string[],
      [groups],
    ),
  );

  const buckets = useMemo(() => {
    const now = new Date();
    const map: Record<BucketKey, NotificationGroup[]> = { new: [], last30: [], earlier: [] };
    for (const g of groups) if (inTab(g.type, activeTab)) map[bucketFor(g, now)].push(g);
    return map;
  }, [groups, activeTab]);
  const tabEmpty = activeTab !== "all" && groups.length > 0 && BUCKET_ORDER.every((k) => buckets[k].length === 0);

  const openGroup = async (group: NotificationGroup) => {
    if ((group.unread_count ?? 0) > 0) {
      try {
        await markGroupRead(group.notification_ids ?? []);
        queryClient.invalidateQueries({ queryKey: ["notification-history", user?.id ?? ""] });
        queryClient.invalidateQueries({ queryKey: queryKeys.notifications(user?.id ?? "") });
      } catch {
        // Never block navigation on the read-marking write.
      }
    }
    // F-95 — a person-destination notification opens their NAME url.
    // S4-b: the row's type rides along, so a comment notification opens the
    // post on that comment.
    navigate(getNotifLink({
      type: group.type,
      reference_id: group.reference_id,
      handle: notifHandles.get(group.reference_id || ""),
    }), { state: notificationEntryState(group.type) });
  };

  /**
   * Delete, not dismiss. There is no undo, so the row goes and the caches are
   * refetched from the server rather than patched optimistically — a list that
   * disagrees with the database is worse than a moment's delay.
   */
  const removeGroup = async (group: NotificationGroup) => {
    try {
      await deleteGroup(group.notification_ids ?? []);
    } catch {
      // Leave the row on screen. A delete that silently "worked" and then came
      // back on the next refetch is the worst of both.
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["notification-history", user?.id ?? ""] });
    queryClient.invalidateQueries({ queryKey: queryKeys.notifications(user?.id ?? "") });
  };

  const followBack = async (actorId: string) => {
    setBusyActor(actorId);
    try {
      await followMutation.mutateAsync({ targetUserId: actorId, isCurrentlyFollowing: false });
      queryClient.invalidateQueries({ queryKey: ["following-set"], exact: false });
    } finally {
      setBusyActor(null);
    }
  };

  return (
    <div className="max-w-2xl mx-auto pb-16">
      <div className="flex items-center gap-3 px-4 py-4 border-b border-border">
        <button
          // S4-c: a cold link straight to /notifications has nothing of ours
          // beneath it — `navigate(-1)` left the site (a blank page in the
          // app). The one rule every page's own Back follows: one step back
          // when there is in-app history, otherwise the feed (replacing).
          onClick={() => goBackOrFeed(navigate, inAppHistoryDepth())}
          aria-label={t("common.back", "Back")}
          /*
           * F-103 — Back. 28x28 to a finger, measured twice independently: the
           * Auditor at desktop and D2 at 360px DPR3, both 28.0 x 28.0. 41% of
           * the required area, on the page the Owner opens by touch. He is
           * blind and he is on Android; a control he cannot land a thumb on is
           * not a polish item.
           *
           * `tap-44` extends the TOUCHABLE region only. The icon stays 28px
           * because 28px is the design, and no layout moves because the
           * ::after is out of flow. It is placed after the first two classes so
           * the gate keeps identifying this as button.p-1.-ml-1 rather than
           * reading one control vanishing and another appearing.
           *
           * ⚠ THIS IS A RAW <button>, NOT THE SHARED COMPONENT. That is the
           * defect underneath: 216 files under src/ use a raw button, so the
           * fix in src/components/ui/button.tsx reaches none of them. Applied
           * here by the Auditor's explicit ruling — his page, three controls,
           * nothing else — and NOT as a pattern to copy 216 times tonight.
           * See docs/evidence/d2/F-104-raw-buttons.md.
           */
          className="p-1 -ml-1 tap-44 text-foreground hover:text-primary transition-colors"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="text-base tracking-[0.08em] uppercase text-foreground" style={headingFont}>
          {t("notifications.title", "Notifications")}
        </h1>
      </div>

      {centreRows && (
        <div
          role="group"
          aria-label={t("notifications.tabs", "Show")}
          className="flex gap-1 overflow-x-auto border-b px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {NOTIFICATION_TABS.map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={activeTab === k}
              onClick={() => setTab(k)}
              className={
                "shrink-0 whitespace-nowrap border-b-2 px-3 py-2.5 text-xs transition-colors " +
                (activeTab === k
                  ? "border-primary font-semibold text-foreground"
                  : "border-transparent text-muted-foreground hover:text-foreground")
              }
              style={bodyFont}
            >
              {t(TAB_LABEL[k].key, TAB_LABEL[k].fallback)}
            </button>
          ))}
        </div>
      )}

      {screen === "loading" && (
        <p className="py-10 text-center text-xs text-muted-foreground animate-pulse" style={bodyFont}>
          {t("common.loading", "Loading...")}
        </p>
      )}

      {screen === "offline" && (
        <p className="py-10 text-center text-xs text-muted-foreground" style={bodyFont}>
          {t("notifications.offline", "No internet. Your notifications will show when you're back online.")}
        </p>
      )}

      {screen === "missing" && isError && (
        <p className="py-10 text-center text-xs text-muted-foreground" style={bodyFont}>
          {t("notifications.load_failed", "Could not load your notifications. Pull down to try again.")}
        </p>
      )}

      {screen === "show" && groups.length === 0 && (
        <div className="py-16 text-center">
          <Bell className="h-6 w-6 text-muted-foreground/20 mx-auto mb-3" />
          <p className="text-xs text-muted-foreground" style={bodyFont}>
            {t("notifications.empty", "Nothing here yet.")}
          </p>
        </div>
      )}

      {screen === "show" && tabEmpty && (
        <p className="py-16 text-center text-xs text-muted-foreground" style={bodyFont}>
          {t("notifications.tab_empty", "Nothing in this tab yet.")}
        </p>
      )}

      {BUCKET_ORDER.map((key) =>
        buckets[key].length === 0 ? null : (
          <section key={key}>
            <h2
              className="px-4 pt-5 pb-2 text-[11px] tracking-[0.2em] uppercase text-muted-foreground"
              style={headingFont}
            >
              {t(`notifications.bucket.${key}`, BUCKET_LABEL[key])}
            </h2>
            {buckets[key].map((group) => (
              <NotificationRow
                key={group.group_key}
                group={group}
                isFollowing={following.has(group.actor_ids?.[0] ?? "")}
                followReady={followReady}
                followPending={busyActor === group.actor_ids?.[0]}
                onOpen={openGroup}
                onFollowBack={followBack}
                onDelete={removeGroup}
                adminIds={adminIds}
                video={videoFor(group)}
                centreRows={centreRows}
              />
            ))}
          </section>
        ),
      )}

      {hasNextPage && (
        <div className="px-4 py-6 text-center">
          <button
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
            className="text-[11px] tracking-[0.15em] uppercase text-muted-foreground hover:text-primary transition-colors disabled:opacity-50"
            style={headingFont}
          >
            {isFetchingNextPage
              ? t("common.loading", "Loading...")
              : t("notifications.load_older", "Load older notifications")}
          </button>
        </div>
      )}
    </div>
  );
};

export default Notifications;
