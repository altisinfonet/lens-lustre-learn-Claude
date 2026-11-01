/**
 * N7b · THE notification-centre list: sections + rows + what each row does.
 *
 * Rendered by the bell's panel and by /notifications (notif_centre_ui on) —
 * one component, one set of reads, one set of actions, so a member sees the
 * same view wherever they open their notifications. The batched reads (who
 * they already follow, mutual follows, comment quotes, video posters,
 * profile handles) happen once per list, never once per row.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useT } from "@/i18n/I18nContext";
import { useAdminIds } from "@/hooks/core/useAdminIds";
import { useMemberHandles } from "@/hooks/profile/useMemberHandles";
import { useFollowingSet } from "@/hooks/notifications/useNotificationHistory";
import { useMutualFollowCounts } from "@/hooks/notifications/useMutualFollows";
import { useCommentPreviews } from "@/hooks/notifications/useCommentPreviews";
import { useNotificationActions } from "@/hooks/notifications/useNotificationActions";
import { fetchPostVideoMap, type FeedVideo } from "@/lib/video/postVideoRead";
import { centreSections } from "@/lib/notifications/sections";
import type { NotificationTab } from "@/lib/notifications/tabs";
import type { NotificationGroup } from "@/lib/notificationText";
import CentreNotificationRow from "@/components/notifications/CentreNotificationRow";

const headingFont = { fontFamily: "var(--font-heading)" };

export default function CentreNotificationList({
  groups,
  tab = "all",
}: {
  /** Already limited to what this member may see (visibleCentreGroups). */
  groups: NotificationGroup[];
  tab?: NotificationTab;
}) {
  const t = useT();
  const adminIds = useAdminIds();

  // F-95 — person-destination types open the member's NAME url; one batched lookup.
  const handles = useMemberHandles(
    groups.filter((g) => g.type === "new_follower" || g.type === "friend_accepted").map((g) => g.reference_id),
  );
  const { openGroup, replyTo, removeGroup, followBack, respondToTag, busyActor } = useNotificationActions(handles);

  // BUG-VID-HOME — a video post has no photograph; one batched poster read.
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

  const newFollowerIds = useMemo(
    () => groups.filter((g) => g.type === "new_follower").map((g) => g.actor_ids?.[0]).filter(Boolean) as string[],
    [groups],
  );
  const { following, ready: followReady } = useFollowingSet(newFollowerIds);
  const mutualFollows = useMutualFollowCounts(newFollowerIds, true);
  const commentPreviews = useCommentPreviews(groups, true);

  const sections = useMemo(() => centreSections(groups, tab), [groups, tab]);

  return (
    <>
      {sections.map((s) => (
        <section key={s.key} data-notif-section={s.key}>
          <h2 className="px-4 pt-5 pb-2 text-[11px] tracking-[0.2em] uppercase text-muted-foreground" style={headingFont}>
            {t(s.label.key, s.label.fallback)}
          </h2>
          {s.groups.map((group) => (
            <CentreNotificationRow
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
              mutualFollows={mutualFollows.get(group.actor_ids?.[0] ?? "")}
              commentPreview={group.reference_id ? commentPreviews.get(group.group_key) : undefined}
              onReply={replyTo}
              onRespondTag={respondToTag}
            />
          ))}
        </section>
      ))}
    </>
  );
}
