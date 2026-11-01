/**
 * N7b · THE notification-centre list: tabs + sections + rows + what each row
 * does.
 *
 * Rendered by the bell's panel and by /notifications (notif_centre_ui on) —
 * one component, one set of reads, one set of actions, so a member sees the
 * same view wherever they open their notifications. The batched reads (who
 * they already follow, mutual follows, comment quotes, video posters,
 * profile handles) happen once per list, never once per row.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useT } from "@/i18n/I18nContext";
import { toast } from "@/hooks/core/use-toast";
import { useAdminIds } from "@/hooks/core/useAdminIds";
import { useMemberHandles } from "@/hooks/profile/useMemberHandles";
import { useFollowingSet } from "@/hooks/notifications/useNotificationHistory";
import { useMutualFollowCounts } from "@/hooks/notifications/useMutualFollows";
import { useCommentPreviews } from "@/hooks/notifications/useCommentPreviews";
import { useNotificationActions } from "@/hooks/notifications/useNotificationActions";
import { useNotificationPreferences } from "@/hooks/notifications/useNotificationPreferences";
import { fetchPostVideoMap, type FeedVideo } from "@/lib/video/postVideoRead";
import { centreSections } from "@/lib/notifications/sections";
import { BELL_SETTING_COVERS, type BellSetting } from "@/lib/notifications/kinds";
import { NOTIFICATION_TABS, TAB_LABEL, type NotificationTab } from "@/lib/notifications/tabs";
import type { NotificationGroup } from "@/lib/notificationText";
import CentreNotificationRow from "@/components/notifications/CentreNotificationRow";

const headingFont = { fontFamily: "var(--font-heading)" };
const bodyFont = { fontFamily: "var(--font-body)" };

export default function CentreNotificationList({
  groups,
  hasMore = false,
  onNavigate,
}: {
  /** Already limited to what this member may see (visibleCentreGroups). */
  groups: NotificationGroup[];
  /** Older notifications exist beyond these (an empty tab says so). */
  hasMore?: boolean;
  /** Called after a row opens something (the bell closes its panel). */
  onNavigate?: () => void;
}) {
  const t = useT();
  const adminIds = useAdminIds();
  const [tab, setTab] = useState<NotificationTab>("all");

  // F-95 — person-destination types open the member's NAME url; one batched lookup.
  const handles = useMemberHandles(
    groups.filter((g) => g.type === "new_follower" || g.type === "friend_accepted").map((g) => g.reference_id),
  );
  const { openGroup, replyTo, removeGroup, followBack, respondToTag, busyActor } = useNotificationActions(handles);
  const { updatePreference } = useNotificationPreferences();

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
  const tabEmpty = tab !== "all" && groups.length > 0 && sections.length === 0;

  const open = async (g: NotificationGroup) => { await openGroup(g); onNavigate?.(); };
  const reply = async (g: NotificationGroup, commentId: string) => { await replyTo(g, commentId); onNavigate?.(); };
  const turnOff = (setting: BellSetting) => {
    updatePreference(setting, false);
    const covers = BELL_SETTING_COVERS[setting];
    toast({
      title: t("notifications.turned_off", "Turned off: {what}").replace("{what}", t(covers.key, covers.fallback)),
      description: t("notifications.turned_off_hint", "No new ones will reach your bell. Turn it back on in Notification settings."),
    });
  };

  if (groups.length === 0) return null;

  return (
    <>
      <div
        role="group"
        aria-label={t("notifications.tabs", "Filter notifications")}
        className="flex gap-1 overflow-x-auto border-b px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {NOTIFICATION_TABS.map((k) => (
          <button
            key={k}
            type="button"
            aria-pressed={tab === k}
            onClick={() => setTab(k)}
            className={
              "shrink-0 whitespace-nowrap border-b-2 px-3 py-2.5 text-xs transition-colors " +
              (tab === k
                ? "border-primary font-semibold text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground")
            }
            style={bodyFont}
          >
            {t(TAB_LABEL[k].key, TAB_LABEL[k].fallback)}
          </button>
        ))}
      </div>

      {tabEmpty && (
        <p className="py-16 text-center text-xs text-muted-foreground" style={bodyFont}>
          {hasMore
            ? t("notifications.tab_empty_more", "Nothing in this tab yet. Older notifications may have some.")
            : t("notifications.tab_empty", "Nothing in this tab yet.")}
        </p>
      )}

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
              onOpen={open}
              onFollowBack={followBack}
              onDelete={removeGroup}
              adminIds={adminIds}
              video={videoFor(group)}
              mutualFollows={mutualFollows.get(group.actor_ids?.[0] ?? "")}
              commentPreview={group.reference_id ? commentPreviews.get(group.group_key) : undefined}
              onReply={reply}
              onRespondTag={respondToTag}
              onTurnOff={turnOff}
            />
          ))}
        </section>
      ))}
    </>
  );
}
