import { useAuth } from "@/hooks/core/useAuth";
import { useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { Bell, Mail, MessageSquare, Heart, Users, Trophy, Gift, GraduationCap, Award, Shield, Volume2 } from "lucide-react";
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

const ToggleRow = ({ icon, label, description, checked, onCheckedChange, disabled, locked }: ToggleRowProps) => {
  const t = useT();
  return (
  <div className="flex items-center justify-between gap-4 py-3 px-1">
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
  </div>
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
