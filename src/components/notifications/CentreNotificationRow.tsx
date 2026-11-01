/**
 * N7b · THE notification-centre row (notif_centre_ui on). One component for
 * the bell panel and for /notifications, web and app alike (the Android app
 * loads this same bundle). Neither surface renders a centre row of its own —
 * src/components/notifications/__tests__/BellAndPageSameRows.test.tsx fails
 * if they ever drift apart again.
 *
 * Moved from src/pages/Notifications.tsx (its N7 centre-row branch), unchanged.
 */
import { Bell, Check, X } from "lucide-react";
import ActorPhrase from "@/components/notifications/ActorPhrase";
import VideoPoster from "@/components/video/VideoPoster";
import { useT } from "@/i18n/I18nContext";
import { centreHeadline, isBigMoment } from "@/lib/notifications/centreWording";
import { describeNotification } from "@/lib/notifications/describe";
import { subjectFromGroup } from "@/lib/notifications/adapters";
import { postMedia } from "@/lib/posts/subjectMedia";
import type { NotificationGroup } from "@/lib/notificationText";
import type { CommentPreview } from "@/hooks/notifications/useCommentPreviews";
import type { FeedVideo } from "@/lib/video/postVideoRead";

const headingFont = { fontFamily: "var(--font-heading)" };
const bodyFont = { fontFamily: "var(--font-body)" };

export function NotificationAvatar({ url, alt }: { url?: string; alt: string }) {
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
export function NotificationRowThumb({ media }: { media: ReturnType<typeof postMedia> }) {
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

export interface CentreNotificationRowProps {
  group: NotificationGroup;
  /** New followers only: how many people the member follows that this follower also follows. */
  mutualFollows?: number;
  /** Comment rows: what they wrote (never a blocked member's words — useCommentPreviews). */
  commentPreview?: CommentPreview;
  /** Open the post on that comment, ready to reply. */
  onReply?: (group: NotificationGroup, commentId: string) => void;
  /** The post's playable video when the notification is about a video post. */
  video: FeedVideo | null;
  isFollowing: boolean;
  followReady: boolean;
  onOpen: (g: NotificationGroup) => void;
  onFollowBack: (actorId: string) => void;
  onDelete: (g: NotificationGroup) => void;
  followPending: boolean;
  /** Passed down rather than fetched per row — one lookup for the whole list. */
  adminIds: Set<string>;
  /** post_tag rows: answer the tag (moved from the bell). */
  onRespondTag?: (group: NotificationGroup, decision: "approved" | "declined") => void;
}

export default function CentreNotificationRow({
  group,
  isFollowing,
  followReady,
  onOpen,
  onFollowBack,
  onDelete,
  followPending,
  adminIds,
  video,
  mutualFollows,
  commentPreview,
  onReply,
  onRespondTag,
}: CentreNotificationRowProps) {
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
  // A photo tag still waiting for an answer: Approve / Decline instead of Delete.
  const pendingTag = group.type === "post_tag" && unread && !!onRespondTag;

  // Impersonal types lead with an app headline; the server text stays
  // underneath (it names the competition / award). Big moments are cards.
  const headline = described.hasActor ? null : centreHeadline(group.type);
  const big = isBigMoment(group.type);
  return (
    <div
      data-notif-big={big ? "true" : undefined}
      className={`flex items-center gap-3 px-4 py-3 border-b border-border/50 transition-colors ${
        big ? "border-l-4 border-l-primary bg-primary/10" : unread ? "bg-primary/5" : ""
      } hover:bg-muted/20`}
    >
      <button
        data-notif-row-open="true"
        onClick={() => onOpen(group)}
        className="flex items-center gap-3 flex-1 min-w-0 text-left rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="relative shrink-0">
          <NotificationAvatar url={group.actor_avatars?.[0] || undefined} alt="" />
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
              {commentPreview && (
                <>
                  {" "}
                  <span className="block line-clamp-2 text-muted-foreground">“{commentPreview.content}”</span>
                </>
              )}
              {group.type === "new_follower" && (mutualFollows ?? 0) > 0 && (
                <>
                  {" "}
                  <span className="block text-muted-foreground">
                    {mutualFollows === 1
                      ? t("notifications.mutual_one", "Also follows 1 person you know")
                      : t("notifications.mutual_many", "Also follows {n} people you know").replace("{n}", String(mutualFollows))}
                  </span>
                </>
              )}
            </>
          ) : headline ? (
            <>
              <strong className="font-semibold">{t(headline.key, headline.fallback)}</strong>{" "}
              <span className="block">{described.text}</span>
            </>
          ) : (
            described.text
          )}{" "}
          <span className="text-muted-foreground">{described.age}</span>
        </span>
        {(media.video || media.imageUrls[0]) && (
          <span className="shrink-0 relative w-11 h-14 overflow-hidden rounded-sm">
            <NotificationRowThumb media={media} />
          </span>
        )}
      </button>

      {commentPreview && onReply && (
        <button
          type="button"
          onClick={() => onReply(group, commentPreview.commentId)}
          aria-label={t("notifications.reply_to", "Reply to {name}").replace(
            "{name}",
            group.actor_names?.[0] || group.actor_usernames?.[0] || t("notifications.a_member", "A member"),
          )}
          className="shrink-0 px-3 py-1.5 tap-44 rounded-md border border-border text-[11px] font-semibold text-foreground hover:bg-muted/40"
          style={headingFont}
        >
          {t("notifications.reply", "Reply")}
        </button>
      )}

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

      {pendingTag ? (
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={() => onRespondTag!(group, "approved")} aria-label={t("notifications.approve_tag", "Approve tag")} className="h-7 w-7 tap-44 rounded-full bg-primary/10 hover:bg-primary/20 flex items-center justify-center text-primary transition-colors" title="Approve">
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button onClick={() => onRespondTag!(group, "declined")} aria-label={t("notifications.decline_tag", "Decline tag")} className="h-7 w-7 tap-44 rounded-full bg-muted hover:bg-destructive/10 flex items-center justify-center text-muted-foreground hover:text-destructive transition-colors" title="Decline">
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      ) : (
        <button
          onClick={() => onDelete(group)}
          aria-label={t("notifications.delete", "Delete")}
          title={t("notifications.delete", "Delete")}
          className="shrink-0 h-7 w-7 tap-44 rounded-full flex items-center justify-center text-muted-foreground/60 hover:text-destructive hover:bg-destructive/10 transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
