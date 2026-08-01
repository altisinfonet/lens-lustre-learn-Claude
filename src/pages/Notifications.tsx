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
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Bell } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/core/useAuth";
import { useT } from "@/i18n/I18nContext";
import { useToggleFollow } from "@/hooks/social/useFriendshipMutations";
import { getNotifLink } from "@/lib/notificationLinks";
import { queryKeys } from "@/lib/queryKeys";
import {
  useNotificationHistory,
  useFollowingSet,
  markGroupRead,
} from "@/hooks/notifications/useNotificationHistory";
import {
  notificationSentence,
  actorPhrase,
  actionPhrase,
  relativeAge,
  bucketFor,
  BUCKET_LABEL,
  actorLabel,
  type NotificationGroup,
  type BucketKey,
} from "@/lib/notificationText";

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

function NotificationRow({
  group,
  isFollowing,
  followReady,
  onOpen,
  onFollowBack,
  followPending,
}: {
  group: NotificationGroup;
  isFollowing: boolean;
  followReady: boolean;
  onOpen: (g: NotificationGroup) => void;
  onFollowBack: (actorId: string) => void;
  followPending: boolean;
}) {
  const t = useT();
  const unread = (group.unread_count ?? 0) > 0;
  const actorId = group.actor_ids?.[0];
  const action = actionPhrase(group);

  // Only offer Follow back when we KNOW they are not already followed.
  // Unknown state must disable the action, never enable it (§0).
  const showFollowBack =
    group.type === "new_follower" && !!actorId && followReady && !isFollowing;

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
        <Avatar url={group.actor_avatars?.[0] || undefined} alt={actorLabel(group, 0)} />
        <span className="text-xs leading-relaxed text-foreground min-w-0" style={bodyFont}>
          {action ? (
            <>
              <span className="font-semibold">{actorPhrase(group)}</span> {action}
            </>
          ) : (
            // types with their own server-written wording render it verbatim
            notificationSentence(group)
          )}{" "}
          <span className="text-muted-foreground">{relativeAge(group.latest_at)}</span>
        </span>
      </button>

      {showFollowBack && (
        <button
          onClick={() => onFollowBack(actorId!)}
          disabled={followPending}
          className="shrink-0 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-[11px] font-semibold disabled:opacity-50"
          style={headingFont}
        >
          {t("notifications.follow_back", "Follow back")}
        </button>
      )}

      {group.thumbnail_url && (
        <button onClick={() => onOpen(group)} className="shrink-0">
          <img
            src={group.thumbnail_url}
            alt=""
            referrerPolicy="no-referrer"
            loading="lazy"
            decoding="async"
            className="w-11 h-14 object-cover rounded-sm"
          />
        </button>
      )}
    </div>
  );
}

const Notifications = () => {
  const t = useT();
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const followMutation = useToggleFollow();
  const [busyActor, setBusyActor] = useState<string | null>(null);

  const { data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useNotificationHistory();

  const groups = useMemo<NotificationGroup[]>(
    () => (data?.pages ?? []).flat(),
    [data],
  );

  const { following, ready: followReady } = useFollowingSet(
    useMemo(
      () => groups.filter((g) => g.type === "new_follower").map((g) => g.actor_ids?.[0]).filter(Boolean) as string[],
      [groups],
    ),
  );

  const buckets = useMemo(() => {
    const now = new Date();
    const map: Record<BucketKey, NotificationGroup[]> = { new: [], last30: [], earlier: [] };
    for (const g of groups) map[bucketFor(g, now)].push(g);
    return map;
  }, [groups]);

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
    navigate(getNotifLink({ type: group.type, reference_id: group.reference_id }));
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
          onClick={() => navigate(-1)}
          aria-label={t("common.back", "Back")}
          className="p-1 -ml-1 text-foreground hover:text-primary transition-colors"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1 className="text-base tracking-[0.08em] uppercase text-foreground" style={headingFont}>
          {t("notifications.title", "Notifications")}
        </h1>
      </div>

      {isLoading && (
        <p className="py-10 text-center text-xs text-muted-foreground animate-pulse" style={bodyFont}>
          {t("common.loading", "Loading...")}
        </p>
      )}

      {isError && (
        <p className="py-10 text-center text-xs text-muted-foreground" style={bodyFont}>
          {t("notifications.load_failed", "Could not load your notifications. Pull down to try again.")}
        </p>
      )}

      {!isLoading && !isError && groups.length === 0 && (
        <div className="py-16 text-center">
          <Bell className="h-6 w-6 text-muted-foreground/20 mx-auto mb-3" />
          <p className="text-xs text-muted-foreground" style={bodyFont}>
            {t("notifications.empty", "Nothing here yet.")}
          </p>
        </div>
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
