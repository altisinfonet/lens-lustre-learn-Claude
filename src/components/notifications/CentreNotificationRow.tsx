/**
 * N7b · THE notification-centre row (notif_centre_ui on). One component for
 * the bell panel and for /notifications, web and app alike (the Android app
 * loads this same bundle). Neither surface renders a centre row of its own —
 * src/components/notifications/__tests__/BellAndPageSameRows.test.tsx fails
 * if they ever drift apart again.
 *
 * The approved Instagram-style row (Owner, N7b):
 *   round avatar — two stacked avatars when several people did it — with a
 *   small type badge (♥ like, comment, + follow, ★ competition, @ mention);
 *   bold names + the plain action, the age inline in grey; the post's picture
 *   on the right; unread = a light tint and a dot. Comment rows quote the
 *   comment with Reply (never a blocked member's words — useCommentPreviews).
 *   No grey X on every row: a ⋯ menu (Remove · Turn off this kind) and, on
 *   touch, swipe left to remove. Follow back on follow rows.
 */
import { useId, useRef, useState } from "react";
import { AtSign, Bell, Check, Heart, MessageCircle, MoreHorizontal, Plus, Star, X } from "lucide-react";
import ActorPhrase from "@/components/notifications/ActorPhrase";
import VideoPoster from "@/components/video/VideoPoster";
import { useT } from "@/i18n/I18nContext";
import { centreHeadline, isBigMoment } from "@/lib/notifications/centreWording";
import { describeNotification } from "@/lib/notifications/describe";
import { subjectFromGroup } from "@/lib/notifications/adapters";
import { badgeFor, bellSettingFor, BELL_SETTING_COVERS, type BellSetting, type NotificationBadge } from "@/lib/notifications/kinds";
import { postMedia } from "@/lib/posts/subjectMedia";
import { useGridPhotoUrl } from "@/hooks/core/useGridPhotoUrl";
import type { NotificationGroup } from "@/lib/notificationText";
import type { CommentPreview } from "@/hooks/notifications/useCommentPreviews";
import type { FeedVideo } from "@/lib/video/postVideoRead";

const headingFont = { fontFamily: "var(--font-heading)" };
const bodyFont = { fontFamily: "var(--font-body)" };

/** Swipe distance (px, leftwards) that removes the row on release. */
const SWIPE_REMOVE_PX = 96;

export function NotificationAvatar({ url, alt, small = false }: { url?: string; alt: string; small?: boolean }) {
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
      className={small ? "h-8 w-8 rounded-full object-cover" : "w-11 h-11 rounded-full object-cover shrink-0"}
    />
  );
}

/** One small round face for the stacked pair (32px), photo or initial. */
function SmallFace({ url, name, className }: { url?: string; name?: string; className: string }) {
  return url ? (
    <span data-notif-avatar="true" className={`h-8 w-8 rounded-full ring-2 ring-background ${className}`}>
      <NotificationAvatar url={url} alt="" small />
    </span>
  ) : (
    <span
      data-notif-avatar="true"
      aria-hidden="true"
      className={`h-8 w-8 rounded-full bg-muted ring-2 ring-background flex items-center justify-center text-[11px] font-semibold text-muted-foreground ${className}`}
    >
      {(name || "?").trim().charAt(0).toUpperCase()}
    </span>
  );
}

const BADGE_ICON: Record<NotificationBadge, typeof Heart> = {
  like: Heart,
  comment: MessageCircle,
  follow: Plus,
  competition: Star,
  mention: AtSign,
};

/** The post's picture for a row: its video's poster, else its photograph. */
export function NotificationRowThumb({ media }: { media: ReturnType<typeof postMedia> }) {
  // Photo plan U2 (switch `photo_set_v2`): a new photo's 320 copy; any other URL unchanged.
  const gridUrl = useGridPhotoUrl();
  const first = media.imageUrls[0];
  return media.video ? (
    <VideoPoster video={media.video} />
  ) : (
    <img
      src={first ? gridUrl(first) : first}
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
  /** Remove (delete) the whole group — the ⋯ menu's Remove and swipe-left. */
  onDelete: (g: NotificationGroup) => void;
  followPending: boolean;
  /** Passed down rather than fetched per row — one lookup for the whole list. */
  adminIds: Set<string>;
  /** post_tag rows: answer the tag (moved from the bell). */
  onRespondTag?: (group: NotificationGroup, decision: "approved" | "declined") => void;
  /** ⋯ Turn off this kind: switch off that bell setting (notification_preferences). */
  onTurnOff?: (setting: BellSetting) => void;
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
  onTurnOff,
}: CentreNotificationRowProps) {
  const t = useT();
  const menuId = useId();
  const [menuOpen, setMenuOpen] = useState(false);
  const [offset, setOffset] = useState(0);
  const swipe = useRef<{ x: number; y: number; dx: number; horizontal: boolean | null } | null>(null);

  const unread = (group.unread_count ?? 0) > 0;
  const actorId = group.actor_ids?.[0];
  const subject = subjectFromGroup(group, adminIds);
  const described = describeNotification(subject);
  const media = postMedia({ video, image_url: group.thumbnail_url });
  const badge = badgeFor(group.type);
  const BadgeIcon = badge ? BADGE_ICON[badge] : null;
  const setting = onTurnOff ? bellSettingFor(group.type) : null;
  const stacked = (group.actor_count ?? 0) > 1 && (group.actor_ids?.length ?? 0) > 1;

  // Only offer Follow back when we KNOW they are not already followed.
  // Unknown state must disable the action, never enable it (§0).
  const showFollowBack =
    group.type === "new_follower" && !!actorId && followReady && !isFollowing;
  // A photo tag still waiting for an answer: Approve / Decline beside the row.
  const pendingTag = group.type === "post_tag" && unread && !!onRespondTag;

  // Impersonal types lead with an app headline; the server text stays
  // underneath (it names the competition / award). Big moments are cards.
  const headline = described.hasActor ? null : centreHeadline(group.type);
  const big = isBigMoment(group.type);

  /* Swipe left to remove — touch only (a mouse never starts one), and only
     once the finger has clearly moved sideways, so scrolling the list is
     never mistaken for a swipe. */
  const onTouchStart = (e: React.TouchEvent) => {
    const p = e.touches[0];
    if (p) swipe.current = { x: p.clientX, y: p.clientY, dx: 0, horizontal: null };
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const s = swipe.current;
    const p = e.touches[0];
    if (!s || !p) return;
    const dx = p.clientX - s.x;
    const dy = p.clientY - s.y;
    if (s.horizontal === null && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) s.horizontal = Math.abs(dx) > Math.abs(dy);
    if (s.horizontal) {
      s.dx = Math.min(0, dx);
      setOffset(s.dx);
    }
  };
  const onTouchEnd = () => {
    const s = swipe.current;
    swipe.current = null;
    setOffset(0);
    if (s?.horizontal && s.dx <= -SWIPE_REMOVE_PX) onDelete(group);
  };

  return (
    <div
      data-notif-row="true"
      data-notif-big={big ? "true" : undefined}
      className={`relative overflow-hidden border-b border-border/50 ${
        big ? "border-l-4 border-l-primary bg-primary/10" : unread ? "bg-primary/5" : ""
      }`}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={() => { swipe.current = null; setOffset(0); }}
    >
      {offset < 0 && (
        <span aria-hidden="true" className="absolute inset-y-0 right-0 flex items-center px-4 bg-destructive text-destructive-foreground text-[11px] font-semibold" style={headingFont}>
          {t("notifications.remove", "Remove")}
        </span>
      )}
      <div
        className={`relative flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/20 ${offset < 0 ? "bg-card" : ""}`}
        style={offset < 0 ? { transform: `translateX(${offset}px)` } : undefined}
      >
        <button
          data-notif-row-open="true"
          onClick={() => onOpen(group)}
          className="flex items-center gap-3 flex-1 min-w-0 text-left rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="relative shrink-0 w-11 h-11">
            {stacked ? (
              <>
                <SmallFace url={group.actor_avatars?.[0] || undefined} name={group.actor_names?.[0]} className="absolute top-0 left-0" />
                <SmallFace url={group.actor_avatars?.[1] || undefined} name={group.actor_names?.[1]} className="absolute bottom-0 right-0" />
              </>
            ) : (
              <span data-notif-avatar="true" className="block">
                <NotificationAvatar url={group.actor_avatars?.[0] || undefined} alt="" />
              </span>
            )}
            {BadgeIcon && (
              <span
                data-notif-badge={badge!}
                aria-hidden="true"
                className="absolute -bottom-1 -right-1 h-5 w-5 rounded-full bg-primary text-primary-foreground ring-2 ring-background flex items-center justify-center"
              >
                <BadgeIcon className="h-3 w-3" />
              </span>
            )}
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

        {pendingTag && (
          <div className="flex items-center gap-1 shrink-0">
            <button onClick={() => onRespondTag!(group, "approved")} aria-label={t("notifications.approve_tag", "Approve tag")} className="h-7 w-7 tap-44 rounded-full bg-primary/10 hover:bg-primary/20 flex items-center justify-center text-primary transition-colors" title="Approve">
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            <button onClick={() => onRespondTag!(group, "declined")} aria-label={t("notifications.decline_tag", "Decline tag")} className="h-7 w-7 tap-44 rounded-full bg-muted hover:bg-destructive/10 flex items-center justify-center text-muted-foreground hover:text-destructive transition-colors" title="Decline">
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        )}

        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          aria-label={t("notifications.more", "More options")}
          aria-expanded={menuOpen}
          aria-controls={menuOpen ? menuId : undefined}
          className="shrink-0 h-7 w-7 tap-44 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors"
        >
          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      {menuOpen && (
        <div id={menuId} className="flex flex-wrap justify-end gap-2 px-4 pb-3" style={headingFont}>
          {setting && (
            <button
              type="button"
              onClick={() => { setMenuOpen(false); onTurnOff!(setting); }}
              aria-describedby={`${menuId}-covers`}
              className="px-3 py-1.5 tap-44 rounded-md border border-border text-[11px] font-semibold text-foreground hover:bg-muted/40"
            >
              {t("notifications.turn_off", "Turn off this kind")}
            </button>
          )}
          {setting && (
            <span id={`${menuId}-covers`} className="sr-only">
              {t(BELL_SETTING_COVERS[setting].key, BELL_SETTING_COVERS[setting].fallback)}
            </span>
          )}
          <button
            type="button"
            onClick={() => { setMenuOpen(false); onDelete(group); }}
            className="px-3 py-1.5 tap-44 rounded-md border border-destructive/40 text-[11px] font-semibold text-destructive hover:bg-destructive/10"
          >
            {t("notifications.remove", "Remove")}
          </button>
        </div>
      )}
    </div>
  );
}
