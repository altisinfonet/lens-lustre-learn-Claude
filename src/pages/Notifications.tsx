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
import { useMemberHandles } from "@/hooks/profile/useMemberHandles";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Bell, X } from "lucide-react";
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
  onDelete,
  followPending,
  adminIds,
}: {
  group: NotificationGroup;
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
        <Avatar url={group.actor_avatars?.[0] || undefined} alt={actorDisplayName(subject.actors[0])} />
        <span className="text-xs leading-relaxed text-foreground min-w-0" style={bodyFont}>
          {described.hasActor ? (
            <>
              <span className="font-semibold">{described.actorText}</span> {described.action}
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

      {/* Remove this line for good. Separate from opening it, and separate
          from the bell's X, which means "mark read". Deleting has no undo, so
          it never shares a control with something that does. */}
      <button
        onClick={() => onDelete(group)}
        aria-label={t("notifications.delete", "Delete")}
        title={t("notifications.delete", "Delete")}
        className="shrink-0 h-7 w-7 rounded-full flex items-center justify-center text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10 transition-colors"
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
  const queryClient = useQueryClient();
  const followMutation = useToggleFollow();
  const [busyActor, setBusyActor] = useState<string | null>(null);

  const { data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useNotificationHistory();

  const groups = useMemo<NotificationGroup[]>(
    () => (data?.pages ?? []).flat(),
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
    // F-95 — a person-destination notification opens their NAME url.
    navigate(getNotifLink({
      type: group.type,
      reference_id: group.reference_id,
      handle: notifHandles.get(group.reference_id || ""),
    }));
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
                onDelete={removeGroup}
                adminIds={adminIds}
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
