import { useAuth } from "@/hooks/core/useAuth";
import { useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { Bell, Mail, MessageSquare, Heart, Users, Trophy, Gift, GraduationCap, Award, Shield, Volume2, Smartphone, Megaphone } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { useNotificationPreferences, type NotificationPreferences } from "@/hooks/notifications/useNotificationPreferences";
import { useNotificationSound } from "@/hooks/core/useNotificationSound";
import PageSEO from "@/components/PageSEO";
import { useT } from "@/i18n/I18nContext";

interface ToggleRowProps {
  icon: React.ReactNode;
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  disabled?: boolean;
  locked?: boolean;
}

/**
 * THE WHOLE ROW IS THE TAP TARGET, not the switch.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The screenshot sweep reported 24 findings on this one screen: every Radix
 * Switch measures 44x24, which is 20px short of the 44px floor.
 *
 * The obvious fixes are both wrong:
 *
 *  • Making the SWITCH 44px tall. A switch that tall is not a switch any more —
 *    it is a slab, and it would be the only control in the app that size.
 *  • An invisible hit area around a 24px switch. The owner already ruled on
 *    that one, on the notification bell, 2026-08-03: "button size same as it
 *    was before" — growing the touch zone while leaving the picture identical
 *    is indistinguishable from doing nothing, and he was right.
 *
 * The fix is the one iOS and Android Settings both use: **the row is the
 * control.** A <label> wraps the whole row, so the icon, the title and the
 * description all toggle the switch — a target 300px wide and ~64px tall
 * instead of a 44x24 sliver at the far right edge, which is also the hardest
 * part of a phone screen to reach one-handed.
 *
 * This is a REAL enlargement, not a measurement trick. It is also why
 * `capture.mjs` had to learn about labels: it was measuring the switch, which
 * is now the wrong element to measure.
 *
 * `htmlFor` is not used because Radix's Switch is a <button>, and a <label>
 * cannot be associated with a button by id — wrapping is what carries the
 * click. `cursor-pointer` and `select-none` are there so a drag across the
 * description does not select text instead of toggling.
 * ─────────────────────────────────────────────────────────────────────────────
 */
const ToggleRow = ({ icon, label, description, checked, onCheckedChange, disabled, locked }: ToggleRowProps) => {
  const t = useT();

  const body = (
    <>
      <div className="flex items-start gap-3 min-w-0">
        <div className="mt-0.5 text-muted-foreground shrink-0">{icon}</div>
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{label}</p>
          <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
        </div>
      </div>
      <div className="shrink-0">
        {locked ? (
          <div className="flex items-center gap-1.5">
            <Shield className="w-3.5 h-3.5 text-primary" />
            <span className="text-[10px] uppercase tracking-wider text-primary font-semibold">{t("notif.alwaysOn")}</span>
          </div>
        ) : (
          <Switch checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
        )}
      </div>
    </>
  );

  // A locked row has nothing to toggle, so it stays a plain div — a <label>
  // with no control in it would offer a tap that does nothing.
  if (locked) {
    return <div className="flex min-h-11 items-center justify-between gap-4 py-3 px-1">{body}</div>;
  }

  return (
    <label
      className={`flex min-h-11 items-center justify-between gap-4 py-3 px-1 select-none rounded-md ${
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer active:bg-accent/40"
      }`}
    >
      {body}
    </label>
  );
};

const SectionHeader = ({ title, subtitle }: { title: string; subtitle?: string }) => (
  <div className="pt-6 pb-2 first:pt-0">
    <h3 className="text-[10px] tracking-[0.25em] uppercase font-semibold text-primary">{title}</h3>
    {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
  </div>
);

const NotificationSettings = () => {
  const t = useT();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { preferences, isLoading, updatePreference } = useNotificationPreferences();
  const { soundEnabled, setSoundEnabled } = useNotificationSound();

  useEffect(() => {
    if (!authLoading && !user) navigate("/login", { replace: true });
  }, [user, authLoading, navigate]);

  if (authLoading || !user) return null;

  const toggle = (field: keyof NotificationPreferences) => (val: boolean) => {
    updatePreference(field, val);
  };

  return (
    <>
      <PageSEO title={t("notif.title")} description={t("notif.subtitle")} />
      <div className="min-h-screen bg-background">
        <div className="max-w-2xl mx-auto px-4 py-8 sm:py-12">
          {/* Header */}
          <div className="flex items-center gap-3 mb-8">
            <div className="p-2 rounded-xl bg-primary/10">
              <Bell className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">{t("notif.title")}</h1>
              <p className="text-sm text-muted-foreground">{t("notif.subtitle")}</p>
            </div>
          </div>

          {isLoading ? (
            <div className="space-y-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full rounded-lg" />
              ))}
            </div>
          ) : (
            <div className="space-y-0 divide-y divide-border/50">

              {/* Account & Security — always ON */}
              <SectionHeader title={t("notif.sec.account")} subtitle={t("notif.sec.accountSub")} />
              <ToggleRow
                icon={<Shield className="w-4 h-4" />}
                label={t("notif.support")}
                description={t("notif.supportDesc")}
                checked={true}
                onCheckedChange={() => {}}
                locked
              />
              <ToggleRow
                icon={<Shield className="w-4 h-4" />}
                label={t("notif.roleDecision")}
                description={t("notif.roleDecisionDesc")}
                checked={true}
                onCheckedChange={() => {}}
                locked
              />
              <ToggleRow
                icon={<Shield className="w-4 h-4" />}
                label={t("notif.friendAccepted")}
                description={t("notif.friendAcceptedDesc")}
                checked={true}
                onCheckedChange={() => {}}
                locked
              />

              {/* Email Notifications */}
              <SectionHeader title={t("notif.sec.email")} subtitle={t("notif.sec.emailSub")} />
              <ToggleRow
                icon={<Heart className="w-4 h-4" />}
                label={t("notif.reactions")}
                description={t("notif.reactionsEmailDesc")}
                checked={preferences.email_reactions}
                onCheckedChange={toggle("email_reactions")}
              />
              <ToggleRow
                icon={<MessageSquare className="w-4 h-4" />}
                label={t("notif.comments")}
                description={t("notif.commentsEmailDesc")}
                checked={preferences.email_comments}
                onCheckedChange={toggle("email_comments")}
              />
              <ToggleRow
                icon={<Users className="w-4 h-4" />}
                label={t("notif.friendRequests")}
                description={t("notif.friendRequestsDesc")}
                checked={preferences.email_friend_requests}
                onCheckedChange={toggle("email_friend_requests")}
              />
              <ToggleRow
                icon={<Users className="w-4 h-4" />}
                label={t("notif.newFollowers")}
                description={t("notif.newFollowersDesc")}
                checked={preferences.email_new_followers}
                onCheckedChange={toggle("email_new_followers")}
              />
              <ToggleRow
                icon={<Trophy className="w-4 h-4" />}
                label={t("notif.compUpdates")}
                description={t("notif.compUpdatesDesc")}
                checked={preferences.email_competition_updates}
                onCheckedChange={toggle("email_competition_updates")}
              />
              <ToggleRow
                icon={<Gift className="w-4 h-4" />}
                label={t("notif.giftCredits")}
                description={t("notif.giftCreditsDesc")}
                checked={preferences.email_gift_credits}
                onCheckedChange={toggle("email_gift_credits")}
              />
              <ToggleRow
                icon={<Award className="w-4 h-4" />}
                label={t("notif.certificates")}
                description={t("notif.certificatesDesc")}
                checked={preferences.email_certificates}
                onCheckedChange={toggle("email_certificates")}
              />
              <ToggleRow
                icon={<GraduationCap className="w-4 h-4" />}
                label={t("notif.courseUpdates")}
                description={t("notif.courseUpdatesDesc")}
                checked={preferences.email_course_updates}
                onCheckedChange={toggle("email_course_updates")}
              />
              <ToggleRow
                icon={<Mail className="w-4 h-4" />}
                label={t("notif.weeklyDigest")}
                description={t("notif.weeklyDigestDesc")}
                checked={preferences.email_weekly_digest}
                onCheckedChange={toggle("email_weekly_digest")}
              />
              <ToggleRow
                icon={<Heart className="w-4 h-4" />}
                label={t("notif.missYou")}
                description={t("notif.missYouDesc")}
                checked={preferences.email_reengagement}
                onCheckedChange={toggle("email_reengagement")}
              />

              {/* In-App Notifications */}
              <SectionHeader title={t("notif.sec.inapp")} subtitle={t("notif.sec.inappSub")} />
              <ToggleRow
                icon={<Heart className="w-4 h-4" />}
                label={t("notif.reactions")}
                description={t("notif.reactionsInappDesc")}
                checked={preferences.inapp_reactions}
                onCheckedChange={toggle("inapp_reactions")}
              />
              <ToggleRow
                icon={<MessageSquare className="w-4 h-4" />}
                label={t("notif.comments")}
                description={t("notif.commentsInappDesc")}
                checked={preferences.inapp_comments}
                onCheckedChange={toggle("inapp_comments")}
              />
              <ToggleRow
                icon={<Users className="w-4 h-4" />}
                label={t("notif.socialActivity")}
                description={t("notif.socialActivityDesc")}
                checked={preferences.inapp_social}
                onCheckedChange={toggle("inapp_social")}
              />
              <ToggleRow
                icon={<Trophy className="w-4 h-4" />}
                label={t("notif.compActivity")}
                description={t("notif.compActivityDesc")}
                checked={preferences.inapp_competitions}
                onCheckedChange={toggle("inapp_competitions")}
              />

              {/* PUSH — the switches the DEVICE obeys.
                  These are not new columns. `push_on_notification()` has read
                  them since 2026-08-01; they had simply never been on screen,
                  so the 12 members with a registered device had no way to turn
                  pushes off. Nothing server-side changed to add this section.

                  There is deliberately NO "new posts" row: the column exists but
                  the trigger does not read it, so a new-post push is governed
                  only by the master switch below. A toggle that does nothing is
                  the fault this section exists to remove. */}
              <SectionHeader title={t("notif.sec.push")} subtitle={t("notif.sec.pushSub")} />
              <ToggleRow
                icon={<Smartphone className="w-4 h-4" />}
                label={t("notif.pushAll")}
                description={t("notif.pushAllDesc")}
                checked={preferences.push_enabled}
                onCheckedChange={toggle("push_enabled")}
              />
              <ToggleRow
                icon={<Heart className="w-4 h-4" />}
                label={t("notif.reactions")}
                description={t("notif.reactionsInappDesc")}
                checked={preferences.push_reactions}
                onCheckedChange={toggle("push_reactions")}
                disabled={!preferences.push_enabled}
              />
              <ToggleRow
                icon={<MessageSquare className="w-4 h-4" />}
                label={t("notif.comments")}
                description={t("notif.commentsInappDesc")}
                checked={preferences.push_comments}
                onCheckedChange={toggle("push_comments")}
                disabled={!preferences.push_enabled}
              />
              <ToggleRow
                icon={<Users className="w-4 h-4" />}
                label={t("notif.friendRequests")}
                description={t("notif.socialActivityDesc")}
                checked={preferences.push_friend_requests}
                onCheckedChange={toggle("push_friend_requests")}
                disabled={!preferences.push_enabled}
              />
              <ToggleRow
                icon={<Users className="w-4 h-4" />}
                label={t("notif.newFollowers")}
                description={t("notif.socialActivityDesc")}
                checked={preferences.push_new_followers}
                onCheckedChange={toggle("push_new_followers")}
                disabled={!preferences.push_enabled}
              />
              <ToggleRow
                icon={<Trophy className="w-4 h-4" />}
                label={t("notif.compUpdates")}
                description={t("notif.compActivityDesc")}
                checked={preferences.push_competition_updates}
                onCheckedChange={toggle("push_competition_updates")}
                disabled={!preferences.push_enabled}
              />
              <ToggleRow
                icon={<Bell className="w-4 h-4" />}
                label={t("notif.pushNewPosts", "New photos from people you follow")}
                description={t("notif.pushNewPostsDesc", "The most frequent alert on the platform. Turn it off and everything else still reaches you.")}
                checked={preferences.push_new_posts}
                onCheckedChange={toggle("push_new_posts")}
                disabled={!preferences.push_enabled}
              />
              {/* ADDED 2026-08-15. New Journal articles and new courses are
                  written to EVERY member, and are deliberately barred from
                  email under BUG-038. Until migration 20260815999999 they were
                  pushed to every device regardless, and the only way to stop
                  them was to switch off push entirely. */}
              <ToggleRow
                icon={<Megaphone className="w-4 h-4" />}
                label={t("notif.pushAnnouncements", "Announcements from 50mm Retina World")}
                description={t("notif.pushAnnouncementsDesc", "New Journal articles and new courses. Turn it off and the people you follow still reach you.")}
                checked={preferences.push_announcements}
                onCheckedChange={toggle("push_announcements")}
                disabled={!preferences.push_enabled}
              />

              {/* Sound */}
              <SectionHeader title={t("notif.sec.sound")} />
              <ToggleRow
                icon={<Volume2 className="w-4 h-4" />}
                label={t("notif.sound")}
                description={t("notif.soundDesc")}
                checked={soundEnabled.current}
                onCheckedChange={(v) => setSoundEnabled(v)}
              />
            </div>
          )}
        </div>
      </div>
    </>
  );
};

export default NotificationSettings;
