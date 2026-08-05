import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Bell, UserPlus, Gift, Check, X, HelpCircle, MessageCircle, Heart, Award, Trophy, Eye, Vote, Users, Camera, BookOpen, GraduationCap, Star, Cake, Newspaper, Tag } from "lucide-react";
import { toast } from "@/hooks/core/use-toast";
import { Link } from "react-router-dom";
import { useAuth } from "@/hooks/core/useAuth";
import { useIsAdmin } from "@/hooks/core/useIsAdmin";
import { supabase } from "@/integrations/supabase/client";
import { motion } from "framer-motion";
import { useNotificationsQuery, type UserNotificationGroup } from "@/hooks/notifications/useNotificationsQuery";
import { useNotificationSound } from "@/hooks/core/useNotificationSound";
import { getNotifLink } from "@/lib/notificationLinks";
import { useDismissOnRouteChange } from "@/hooks/core/useDismissOnRouteChange";
import { useIsPrimaryInstance } from "@/hooks/core/useIsPrimaryInstance";
import { describeNotification, relativeAge } from "@/lib/notifications/describe";
import { subjectFromGroup } from "@/lib/notifications/adapters";
import { useAdminIds } from "@/hooks/core/useAdminIds";
import { markGroupRead } from "@/hooks/notifications/useNotificationHistory";

const headingFont = { fontFamily: "var(--font-heading)" };
const bodyFont = { fontFamily: "var(--font-body)" };

// Types re-exported from useNotificationsQuery — no local duplicates needed

const NOTIF_ICON: Record<string, typeof Heart> = {
  post_reaction: Heart,
  image_reaction: Heart,
  post_comment: MessageCircle,
  image_comment: MessageCircle,
  comment_reply: MessageCircle,
  competition_vote: Vote,
  entry_approved: Award,
  entry_rejected: X,
  competition_winner: Trophy,
  new_follower: Eye,
  ticket_reply: HelpCircle,
  deposit_approved: Gift,
  deposit_rejected: X,
  friend_accepted: Users,
  friend_request: UserPlus,
  role_approved: Award,
  role_rejected: X,
  badge_awarded: Award,
  certificate_issued: GraduationCap,
  potd_featured: Camera,
  new_competition: Trophy,
  journal_published: Newspaper,
  course_published: BookOpen,
  featured_artist: Star,
  post_tag: Tag,
  // "🎉 Today is <name>'s Birthday". Without an entry here the row falls back to
  // the generic Bell, which is what every undecided type has always looked like.
  birthday: Cake,
};

const NOTIF_CATEGORY: Record<string, string> = {
  post_reaction: "Reactions",
  image_reaction: "Reactions",
  post_comment: "Comments",
  image_comment: "Comments",
  comment_reply: "Replies",
  competition_vote: "Votes",
  entry_approved: "Competition Updates",
  entry_rejected: "Competition Updates",
  competition_winner: "Competition Updates",
  new_competition: "Competition Updates",
  new_follower: "Followers",
  ticket_reply: "Support Updates",
  deposit_approved: "Wallet Updates",
  deposit_rejected: "Wallet Updates",
  friend_accepted: "Friends",
  friend_request: "Friends",
  role_approved: "Role Updates",
  role_rejected: "Role Updates",
  badge_awarded: "Achievements",
  certificate_issued: "Achievements",
  potd_featured: "Featured",
  journal_published: "Journal",
  course_published: "Courses",
  featured_artist: "Featured",
  post_tag: "Photo Tags",
  birthday: "Birthdays",
};


const NotificationBell = () => {
  const { user } = useAuth();
  const { isAdmin } = useIsAdmin();
  const [open, setOpen] = useState(false);
  const { playNotificationSound } = useNotificationSound();
  const prevCountRef = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);
  // Needed to render an admin as the brand rather than a real name — the same
  // hook, and therefore the same rule, that /notifications uses.
  const adminIds = useAdminIds();

  // All notification data lives in React Query cache — no local state
  const {
    friendRequests,
    giftNotifications,
    adminNotifications,
    userNotifications,
    unreadTotal,
    totalCount,
    isLoading: loading,
    cache,
  } = useNotificationsQuery(user?.id, isAdmin);

  // Play a sound when new notifications arrive — ONCE, not once per copy.
  //
  // This component is mounted twice: a desktop copy and a mobile copy, one
  // hidden by CSS. CSS hides, it does not unmount, so both ran this effect and
  // the chime played twice on every arrival. Only the primary instance plays.
  const isPrimaryBell = useIsPrimaryInstance(user?.id ? `notification-bell:${user.id}` : "");
  useEffect(() => {
    const rose = totalCount > prevCountRef.current && prevCountRef.current > 0;
    // Track the count in EVERY instance, primary or not. If only the primary
    // tracked it, promoting a new primary after an unmount would leave it with
    // a stale baseline of 0 and swallow the next sound.
    prevCountRef.current = totalCount;
    if (rose && isPrimaryBell) playNotificationSound();
  }, [totalCount, playNotificationSound, isPrimaryBell]);

  // LAYER 1 — a route change always closes it.
  //
  // This is the layer that holds when nothing else does. On 2026-08-01 the
  // owner tapped "See All": the page changed and the panel stayed. Measured on
  // production, the node was still in the DOM at opacity 0 with the closing
  // transform applied — so the click HAD been delivered and setOpen(false) HAD
  // run, and the element was still never removed. Anything that depends on a
  // handler firing, or on an animation finishing, can fail. A layout effect
  // keyed on the navigation cannot. See useDismissOnRouteChange.
  useDismissOnRouteChange(() => setOpen(false));

  // LAYER 4 — Escape is ALWAYS listening, even while closed.
  //
  // It used to live in the `if (!open) return` effect below. That meant the
  // listener was torn down the instant `open` flipped to false — which, while
  // the panel was still stuck on screen, left the user pressing Escape at
  // something with nothing attached to it. Verified on production: Escape did
  // nothing. One always-live keydown listener costs nothing and removes the
  // whole "the listener was gone before the panel was" failure class.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Close on outside click (works inside transformed ancestors like Drawer)
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      const target = e.target as Node | null;
      if (containerRef.current && target && !containerRef.current.contains(target)) {
        setOpen(false);
      }
    };
    // Close when the PAGE scrolls behind the open panel — but never when the
    // panel's own list is scrolled. `scroll` does not bubble, yet a capture-phase
    // listener on window still receives scrolls dispatched to any element in the
    // document, including this panel's `overflow-y-auto` list. Without this guard
    // the panel closed the instant the user dragged the notification list.
    const onScroll = (e: Event) => {
      const target = e.target as Node | null;
      if (target && containerRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open]);

  /**
   * Answering a friend request must also close the notification it came from.
   *
   * It did not, and the row simply stayed unread for ever: 14 rows on production
   * on 2026-08-02 were unread friend_request notifications for requests that had
   * ALREADY been accepted. The notification's `reference_id` is the requester's
   * profile id (verified: 113 of 127 rows), which is what makes this findable
   * without knowing the notification's own id.
   *
   * It runs after the friendship write and its failure is swallowed: a
   * notification that stays unread is a much smaller problem than a friend
   * request that appears not to have been accepted.
   */
  const clearFriendRequestNotification = async (requesterId: string) => {
    if (!user) return;
    try {
      await supabase
        .from("user_notifications")
        .update({ is_read: true })
        .eq("user_id", user.id)
        .eq("type", "friend_request")
        .eq("reference_id", requesterId)
        .eq("is_read", false);
    } catch {
      /* see above */
    }
  };

  const acceptFriend = async (id: string, requesterId: string) => {
    await supabase.from("friendships").update({ status: "accepted" }).eq("id", id);
    cache.removeFriendRequest(id);
    await clearFriendRequestNotification(requesterId);
    setOpen(false);
  };

  const declineFriend = async (id: string, requesterId: string) => {
    await supabase.from("friendships").delete().eq("id", id);
    cache.removeFriendRequest(id);
    await clearFriendRequestNotification(requesterId);
    setOpen(false);
  };

  const dismissGift = async (id: string) => {
    await supabase.functions.invoke("manage-notifications", {
      body: { action: "dismiss_gift", id },
    });
    cache.removeGift(id);
    setOpen(false);
  };

  const dismissAdminNotification = async (id: string) => {
    await supabase.functions.invoke("manage-notifications", {
      body: { action: "dismiss_admin", id },
    });
    cache.removeAdminNotification(id);
    setOpen(false);
  };

  /**
   * Dismiss a whole GROUP.
   *
   * The line says "Partha, Tanmay and 31 others reacted to your photo" — so the
   * X next to it has to clear all 33, not one of them. `markGroupRead` marks
   * every id in the group; RLS ("Users can update own notifications") already
   * restricts that to this member's own rows, which is why it needs no edge
   * function — the same call /notifications has been using since Stage 1.
   *
   * Types that carry an individual action (friend_request, post_tag,
   * new_follower) are never grouped by notif_group_key(), so for those this is
   * exactly one notification and behaves as it always did.
   */
  const dismissUserGroup = async (group: UserNotificationGroup, close = true) => {
    cache.removeUserGroup(group.group_key);
    try {
      await markGroupRead(group.notification_ids ?? []);
    } catch {
      /* The row stays unread and the next refetch brings it back — better than
         a panel that lies about what it cleared. */
    }
    if (close) setOpen(false);
  };

  const respondToTag = async (group: UserNotificationGroup, decision: "approved" | "declined") => {
    if (!user || !group.reference_id) return;
    const { error } = await supabase
      .from("post_tags")
      .update({ status: decision, responded_at: new Date().toISOString() })
      .eq("post_id", group.reference_id)
      .eq("tagged_user_id", user.id)
      .eq("status", "pending");
    if (error) {
      toast({ title: "Couldn't update tag", description: error.message, variant: "destructive" });
      return;
    }
    await dismissUserGroup(group, false);
    toast({
      title: decision === "approved" ? "Tag approved" : "Tag declined",
      description: decision === "approved" ? "Now visible on your Photos of You." : "This person can no longer tag you on this post.",
    });
    setOpen(false);
  };

  const markAllRead = async () => {
    if (!user) return;
    await supabase.functions.invoke("manage-notifications", {
      body: { action: "mark_all_read", includeAdmin: isAdmin },
    });
    cache.clearAll();
  };

  // Ages come from the shared formatter. There used to be a second, bell-only
  // implementation here ("5m ago") while the history page used another ("5m"),
  // so the same event showed two different ages depending on where you looked.
  const timeAgoFn = (dateStr: string) => relativeAge(dateStr);

  if (!user) return null;

  // Sort the already-grouped rows into the panel's category headings.
  const groupedNotifs = userNotifications.reduce<Record<string, UserNotificationGroup[]>>(
    (acc, g) => {
      const cat = NOTIF_CATEGORY[g.type] || "Other";
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(g);
      return acc;
    },
    {},
  );

  /**
   * True when the badge counts more than the panel is showing.
   *
   * The panel asks for 20 groups; a member can have far more (83 was the
   * highest on production, mostly individual followers, which are deliberately
   * never grouped). Saying so out loud is the point: the previous bell just
   * stopped at 30 and said nothing.
   */
  const shownEvents = userNotifications.reduce((n, g) => n + (g.event_count ?? 1), 0);
  const hiddenEvents = Math.max(0, unreadTotal - shownEvents);

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen(!open)}
        className="relative p-2 rounded-full border border-border hover:border-primary hover:text-primary transition-all duration-500"
        aria-label="Notifications"
        aria-expanded={open}
        aria-controls="notification-panel"
        aria-haspopup="dialog"
      >
        <Bell className="h-4 w-4" />
        {totalCount > 0 && (
          <span className="absolute -top-1 -right-1 h-4 min-w-[16px] px-1 flex items-center justify-center rounded-full bg-primary text-primary-foreground text-[9px] font-bold leading-none">
            {totalCount > 99 ? "99+" : totalCount}
          </span>
        )}
      </button>

      {/* LAYER 2 — the panel is removed by plain React reconciliation.
          There is deliberately NO <AnimatePresence> and NO `exit` prop here.
          AnimatePresence keeps an exiting child MOUNTED until its animation
          reports completion, and on 2026-08-01 that completion never came: the
          panel sat in the DOM at opacity 0 with `transform: scale(0.95)
          translateY(8px)`, a 304x456 invisible rectangle over the top-right of
          every page, swallowing every click inside it until a full reload. On
          Android the animation could not run at all, so the panel simply stayed
          visible over the new page — which is what the owner reported.
          The entrance animation stays; it does not gate unmount. Losing the
          200ms fade-out is the price, and it is the right one.
          NotificationBellDismiss.test.tsx fails the build if this comes back. */}
      {open && (
        <>
          {/* LAYER 3 — a real backdrop, portalled to <body> so no transformed or
              blurred ancestor can trap it. `pointerdown`, not `click`: an
              Android webview drops the click on an element that disappears
              under the finger, which is exactly how this class of bug started.
              z-40 keeps it under the z-50 navbar and over the page. */}
          {createPortal(
            <div
              data-testid="notif-scrim"
              className="fixed inset-0 z-40"
              onPointerDown={() => setOpen(false)}
              aria-hidden="true"
            />,
            document.body,
          )}
            <motion.div
              id="notification-panel"
              role="dialog"
              aria-label="Notifications"
              initial={{ opacity: 0, y: 8, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.2 }}
              className="absolute right-0 top-full mt-2 w-80 max-h-[480px] bg-card border border-border shadow-xl z-50 overflow-hidden flex flex-col"
            >
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <span className="text-[11px] tracking-[0.2em] uppercase text-foreground" style={headingFont}>
                  Notifications
                </span>
                <div className="flex items-center gap-3">
                  {totalCount > 0 && (
                    <>
                      <span className="text-[10px] text-primary" style={headingFont}>
                        {totalCount} new
                      </span>
                      <button
                        onClick={markAllRead}
                        className="text-[9px] tracking-[0.1em] uppercase text-muted-foreground hover:text-primary transition-colors"
                        style={headingFont}
                      >
                        Mark all read
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Content */}
              <div className="overflow-y-auto flex-1">
                {loading && totalCount === 0 ? (
                  <div className="py-8 text-center">
                    <span className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground animate-pulse" style={headingFont}>
                      Loading...
                    </span>
                  </div>
                ) : totalCount === 0 ? (
                  <div className="py-10 text-center">
                    <Bell className="h-6 w-6 text-muted-foreground/20 mx-auto mb-2" />
                    <p className="text-xs text-muted-foreground" style={bodyFont}>
                      No new notifications
                    </p>
                  </div>
                ) : (
                  <>
                    {/* Friend Requests */}
                    {friendRequests.length > 0 && (
                      <NotifSection title="Friend Requests">
                        {friendRequests.map((fr) => (
                          <div key={fr.id} className="flex items-center gap-3 px-4 py-3 border-b border-border/50 hover:bg-muted/20 transition-colors">
                            <Link to={`/profile/${fr.requester_id}`} onClick={() => setOpen(false)} className="shrink-0">
                              {fr.requester_avatar ? (
                                <img referrerPolicy="no-referrer" loading="lazy" decoding="async" src={fr.requester_avatar} alt="" className="w-9 h-9 rounded-full object-cover" />
                              ) : (
                                <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center">
                                  <UserPlus className="h-4 w-4 text-primary" />
                                </div>
                              )}
                            </Link>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs line-clamp-2" style={bodyFont}>
                                <span className="inline-flex items-center gap-1 flex-wrap">
                                  <Link to={`/profile/${fr.requester_id}`} onClick={() => setOpen(false)} className="font-medium hover:text-primary transition-colors">
                                    {fr.requester_name || "Someone"}
                                  </Link>
                                </span>
                                {" "}sent you a friend request
                              </p>
                              <span className="text-[9px] text-muted-foreground" style={headingFont}>{timeAgoFn(fr.created_at)}</span>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                              <button onClick={() => acceptFriend(fr.id, fr.requester_id)} className="h-7 w-7 rounded-full bg-primary/10 hover:bg-primary/20 flex items-center justify-center text-primary transition-colors" title="Accept">
                                <Check className="h-3.5 w-3.5" />
                              </button>
                              <button onClick={() => declineFriend(fr.id, fr.requester_id)} className="h-7 w-7 rounded-full bg-muted hover:bg-destructive/10 flex items-center justify-center text-muted-foreground hover:text-destructive transition-colors" title="Decline">
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </NotifSection>
                    )}

                    {/* Gift Credits */}
                    {giftNotifications.length > 0 && (
                      <NotifSection title="Gift Credits">
                        {giftNotifications.map((gift) => (
                          <div key={gift.id} className="flex items-center gap-3 px-4 py-3 border-b border-border/50 hover:bg-muted/20 transition-colors">
                            <div className="w-9 h-9 rounded-full bg-accent/10 flex items-center justify-center shrink-0">
                              <Gift className="h-4 w-4 text-primary" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs" style={bodyFont}>
                                You received <span className="font-semibold text-primary">${gift.amount}</span>{" — "}{gift.reason}
                              </p>
                              <span className="text-[9px] text-muted-foreground" style={headingFont}>
                                {timeAgoFn(gift.created_at)}
                                {gift.expires_at && <> · Expires {new Date(gift.expires_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</>}
                              </span>
                            </div>
                            <button onClick={() => dismissGift(gift.id)} className="h-7 w-7 rounded-full bg-muted hover:bg-muted/80 flex items-center justify-center text-muted-foreground shrink-0 transition-colors" title="Dismiss">
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                      </NotifSection>
                    )}

                    {/* User notifications — ONE LINE PER GROUP.
                        The database decides what a group is (notif_group_key),
                        so a day of reactions is one line here and one line on
                        /notifications. It used to be 40 lines here and 1 there. */}
                    {Object.entries(groupedNotifs).map(([category, groups]) => (
                      <NotifSection key={category} title={category}>
                        {groups.map((group) => {
                          const IconComp = NOTIF_ICON[group.type] || Bell;
                          const avatar = group.actor_avatars?.[0]?.trim() || null;
                          const link = getNotifLink(group);
                          // Same function, same words, as the history page.
                          const described = describeNotification(subjectFromGroup(group, adminIds));
                          return (
                            <div key={group.group_key} className="flex items-center gap-3 px-4 py-3 border-b border-border/50 hover:bg-muted/20 transition-colors">
                              <Link to={link} onClick={() => dismissUserGroup(group)} className="shrink-0">
                                {avatar ? (
                                  <div className="relative">
                                    <img referrerPolicy="no-referrer" loading="lazy" decoding="async" src={avatar} alt="" className="w-9 h-9 rounded-full object-cover" />
                                    <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-primary flex items-center justify-center">
                                      <IconComp className="h-2.5 w-2.5 text-primary-foreground" />
                                    </div>
                                  </div>
                                ) : (
                                  <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center">
                                    <IconComp className="h-4 w-4 text-primary" />
                                  </div>
                                )}
                              </Link>
                              <div className="flex-1 min-w-0">
                                {/* `line-clamp-2`, not `truncate`: this column is
                                    about 200px wide and a one-line clip cut names
                                    mid-word ("Partha Dalal started following y…"). */}
                                <Link to={link} onClick={() => dismissUserGroup(group)} className="text-xs hover:text-primary transition-colors block line-clamp-2" style={bodyFont}>
                                  {described.text}
                                </Link>
                                <span className="text-[9px] text-muted-foreground" style={headingFont}>{timeAgoFn(group.latest_at)}</span>
                              </div>
                              {group.type === "post_tag" ? (
                                <div className="flex items-center gap-1 shrink-0">
                                  <button onClick={() => respondToTag(group, "approved")} className="h-7 w-7 rounded-full bg-primary/10 hover:bg-primary/20 flex items-center justify-center text-primary transition-colors" title="Approve">
                                    <Check className="h-3.5 w-3.5" />
                                  </button>
                                  <button onClick={() => respondToTag(group, "declined")} className="h-7 w-7 rounded-full bg-muted hover:bg-destructive/10 flex items-center justify-center text-muted-foreground hover:text-destructive transition-colors" title="Decline">
                                    <X className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              ) : (
                                <button onClick={() => dismissUserGroup(group, false)} className="h-7 w-7 rounded-full bg-muted hover:bg-muted/80 flex items-center justify-center text-muted-foreground shrink-0 transition-colors" title={group.event_count > 1 ? `Dismiss all ${group.event_count}` : "Dismiss"}>
                                  <X className="h-3 w-3" />
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </NotifSection>
                    ))}

                    {/* Admin Notifications */}
                    {adminNotifications.length > 0 && (
                      <NotifSection title="Admin Alerts">
                        {adminNotifications.map((notif) => (
                          <div key={notif.id} className="flex items-center gap-3 px-4 py-3 border-b border-border/50 hover:bg-muted/20 transition-colors">
                            <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                              <HelpCircle className="h-4 w-4 text-primary" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <Link to="/admin" onClick={() => { setOpen(false); localStorage.setItem("admin-active-tab", "support_tickets"); }} className="text-xs font-medium hover:text-primary transition-colors block line-clamp-2" style={bodyFont}>
                                {notif.message}
                              </Link>
                              <span className="text-[9px] text-muted-foreground" style={headingFont}>{timeAgoFn(notif.created_at)}</span>
                            </div>
                            <button onClick={() => dismissAdminNotification(notif.id)} className="h-7 w-7 rounded-full bg-muted hover:bg-muted/80 flex items-center justify-center text-muted-foreground shrink-0 transition-colors" title="Dismiss">
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        ))}
                      </NotifSection>
                    )}
                  </>
                )}
              </div>

              {/* Say it when the panel is not showing everything, rather than
                  quietly stopping — which is what the old 30-row cap did. */}
              {hiddenEvents > 0 && (
                <div className="px-4 py-2 border-t border-border/50 text-center">
                  <Link to="/notifications" onClick={() => setOpen(false)} className="text-[10px] text-muted-foreground hover:text-primary transition-colors" style={bodyFont}>
                    {hiddenEvents} more not shown here — see all
                  </Link>
                </div>
              )}

              {/* Footer */}
              <div className="border-t border-border px-4 py-2.5 flex items-center justify-center gap-4">
                {/* The bell is an UNREAD inbox; the full history lives on /notifications. */}
                <Link to="/notifications" onClick={() => setOpen(false)} className="text-[10px] tracking-[0.15em] uppercase text-primary hover:underline" style={headingFont}>
                  See All
                </Link>
                <span className="text-[10px] text-border">|</span>
                <Link to="/friends" onClick={() => setOpen(false)} className="text-[10px] tracking-[0.15em] uppercase text-primary hover:underline" style={headingFont}>
                  View All Friends
                </Link>
              </div>
            </motion.div>
        </>
      )}
    </div>
  );
};

const NotifSection = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div>
    <div className="px-4 py-2 bg-muted/30">
      <span className="text-[9px] tracking-[0.2em] uppercase text-muted-foreground" style={headingFont}>
        {title}
      </span>
    </div>
    {children}
  </div>
);

export default NotificationBell;
