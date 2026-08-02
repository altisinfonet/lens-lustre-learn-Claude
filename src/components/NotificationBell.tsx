import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Bell, UserPlus, Gift, Check, X, HelpCircle, MessageCircle, Heart, Award, Trophy, Eye, Vote, Users, Camera, BookOpen, GraduationCap, Star, Cake, Newspaper, Tag } from "lucide-react";
import { toast } from "@/hooks/core/use-toast";
import { Link } from "react-router-dom";
import { useAuth } from "@/hooks/core/useAuth";
import { useIsAdmin } from "@/hooks/core/useIsAdmin";
import { supabase } from "@/integrations/supabase/client";
import { motion } from "framer-motion";
import { useNotificationsQuery, type UserNotification } from "@/hooks/notifications/useNotificationsQuery";
import { useNotificationSound } from "@/hooks/core/useNotificationSound";
import { getNotifLink } from "@/lib/notificationLinks";
import { useDismissOnRouteChange } from "@/hooks/core/useDismissOnRouteChange";
import { useIsPrimaryInstance } from "@/hooks/core/useIsPrimaryInstance";
import { describeNotification, relativeAge } from "@/lib/notifications/describe";
import { subjectFromRow } from "@/lib/notifications/adapters";

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
};


const NotificationBell = () => {
  const { user } = useAuth();
  const { isAdmin } = useIsAdmin();
  const [open, setOpen] = useState(false);
  const { playNotificationSound } = useNotificationSound();
  const prevCountRef = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // All notification data lives in React Query cache — no local state
  const {
    friendRequests,
    giftNotifications,
    adminNotifications,
    userNotifications,
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

  const acceptFriend = async (id: string) => {
    await supabase.from("friendships").update({ status: "accepted" }).eq("id", id);
    cache.removeFriendRequest(id);
    setOpen(false);
  };

  const declineFriend = async (id: string) => {
    await supabase.from("friendships").delete().eq("id", id);
    cache.removeFriendRequest(id);
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

  const dismissUserNotification = async (id: string) => {
    await supabase.functions.invoke("manage-notifications", {
      body: { action: "dismiss_user", id },
    });
    cache.removeUserNotification(id);
    setOpen(false);
  };

  const respondToTag = async (notif: UserNotification, decision: "approved" | "declined") => {
    if (!user || !notif.reference_id) return;
    const { error } = await supabase
      .from("post_tags")
      .update({ status: decision, responded_at: new Date().toISOString() })
      .eq("post_id", notif.reference_id)
      .eq("tagged_user_id", user.id)
      .eq("status", "pending");
    if (error) {
      toast({ title: "Couldn't update tag", description: error.message, variant: "destructive" });
      return;
    }
    await supabase.functions.invoke("manage-notifications", {
      body: { action: "dismiss_user", id: notif.id },
    });
    cache.removeUserNotification(notif.id);
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

  // Group user notifications by category
  const groupedNotifs = userNotifications.reduce<Record<string, UserNotification[]>>((acc, n) => {
    const cat = NOTIF_CATEGORY[n.type] || "Other";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(n);
    return acc;
  }, {});

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
                              <button onClick={() => acceptFriend(fr.id)} className="h-7 w-7 rounded-full bg-primary/10 hover:bg-primary/20 flex items-center justify-center text-primary transition-colors" title="Accept">
                                <Check className="h-3.5 w-3.5" />
                              </button>
                              <button onClick={() => declineFriend(fr.id)} className="h-7 w-7 rounded-full bg-muted hover:bg-destructive/10 flex items-center justify-center text-muted-foreground hover:text-destructive transition-colors" title="Decline">
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

                    {/* Grouped User Notifications */}
                    {Object.entries(groupedNotifs).map(([category, notifs]) => (
                      <NotifSection key={category} title={category}>
                        {notifs.map((notif) => {
                          const IconComp = NOTIF_ICON[notif.type] || Bell;
                          return (
                            <div key={notif.id} className="flex items-center gap-3 px-4 py-3 border-b border-border/50 hover:bg-muted/20 transition-colors">
                              <Link to={getNotifLink(notif)} onClick={() => { dismissUserNotification(notif.id); setOpen(false); }} className="shrink-0">
                                {(notif as any).actor_avatar ? (
                                  <div className="relative">
                                    <img referrerPolicy="no-referrer" loading="lazy" decoding="async" src={(notif as any).actor_avatar} alt="" className="w-9 h-9 rounded-full object-cover" />
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
                                {/* The SENTENCE is composed here, from the same
                                    function the history page uses — the bell used to
                                    render `notif.message`, the string a trigger froze
                                    when the event happened, so the two surfaces said
                                    different things about the same event.
                                    `line-clamp-2`, not `truncate`: this column is about
                                    200px wide and a one-line clip cut names mid-word
                                    ("Partha Dalal started following y…"). */}
                                <Link to={getNotifLink(notif)} onClick={() => { dismissUserNotification(notif.id); setOpen(false); }} className="text-xs hover:text-primary transition-colors block line-clamp-2" style={bodyFont}>
                                  {describeNotification(subjectFromRow(notif as any)).text}
                                </Link>
                                <span className="text-[9px] text-muted-foreground" style={headingFont}>{timeAgoFn(notif.created_at)}</span>
                              </div>
                              {notif.type === "post_tag" ? (
                                <div className="flex items-center gap-1 shrink-0">
                                  <button onClick={() => respondToTag(notif, "approved")} className="h-7 w-7 rounded-full bg-primary/10 hover:bg-primary/20 flex items-center justify-center text-primary transition-colors" title="Approve">
                                    <Check className="h-3.5 w-3.5" />
                                  </button>
                                  <button onClick={() => respondToTag(notif, "declined")} className="h-7 w-7 rounded-full bg-muted hover:bg-destructive/10 flex items-center justify-center text-muted-foreground hover:text-destructive transition-colors" title="Decline">
                                    <X className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              ) : (
                                <button onClick={() => dismissUserNotification(notif.id)} className="h-7 w-7 rounded-full bg-muted hover:bg-muted/80 flex items-center justify-center text-muted-foreground shrink-0 transition-colors" title="Dismiss">
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
