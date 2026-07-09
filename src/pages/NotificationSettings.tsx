import { useAuth } from "@/hooks/core/useAuth";
import { useNavigate } from "react-router-dom";
import { useEffect } from "react";
import { Bell, Mail, MessageSquare, Heart, Users, Trophy, Gift, GraduationCap, Award, Shield, Volume2 } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { useNotificationPreferences, type NotificationPreferences } from "@/hooks/notifications/useNotificationPreferences";
import { useNotificationSound } from "@/hooks/core/useNotificationSound";
import PageSEO from "@/components/PageSEO";

interface ToggleRowProps {
  icon: React.ReactNode;
  label: string;
  description: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  disabled?: boolean;
  locked?: boolean;
}

const ToggleRow = ({ icon, label, description, checked, onCheckedChange, disabled, locked }: ToggleRowProps) => (
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
          <span className="text-[10px] uppercase tracking-wider text-primary font-semibold">Always On</span>
        </div>
      ) : (
        <Switch checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
      )}
    </div>
  </div>
);

const SectionHeader = ({ title, subtitle }: { title: string; subtitle?: string }) => (
  <div className="pt-6 pb-2 first:pt-0">
    <h3 className="text-[10px] tracking-[0.25em] uppercase font-semibold text-primary">{title}</h3>
    {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
  </div>
);

const NotificationSettings = () => {
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
      <PageSEO title="Notification Settings" description="Manage your notification preferences" />
      <div className="min-h-screen bg-background">
        <div className="max-w-2xl mx-auto px-4 py-8 sm:py-12">
          {/* Header */}
          <div className="flex items-center gap-3 mb-8">
            <div className="p-2 rounded-xl bg-primary/10">
              <Bell className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-foreground">Notification Settings</h1>
              <p className="text-sm text-muted-foreground">Choose what you want to be notified about</p>
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
              <SectionHeader title="Account & Security" subtitle="These cannot be disabled for your safety" />
              <ToggleRow
                icon={<Shield className="w-4 h-4" />}
                label="Support Ticket Replies"
                description="When our team replies to your support ticket"
                checked={true}
                onCheckedChange={() => {}}
                locked
              />
              <ToggleRow
                icon={<Shield className="w-4 h-4" />}
                label="Role Application Decisions"
                description="When your role application is approved or rejected"
                checked={true}
                onCheckedChange={() => {}}
                locked
              />
              <ToggleRow
                icon={<Shield className="w-4 h-4" />}
                label="Friend Request Accepted"
                description="When someone accepts your friend request"
                checked={true}
                onCheckedChange={() => {}}
                locked
              />

              {/* Email Notifications */}
              <SectionHeader title="Email Notifications" subtitle="Control which emails you receive" />
              <ToggleRow
                icon={<Heart className="w-4 h-4" />}
                label="Reactions"
                description="When someone reacts to your post or photo"
                checked={preferences.email_reactions}
                onCheckedChange={toggle("email_reactions")}
              />
              <ToggleRow
                icon={<MessageSquare className="w-4 h-4" />}
                label="Comments & Replies"
                description="When someone comments on your content or replies to you"
                checked={preferences.email_comments}
                onCheckedChange={toggle("email_comments")}
              />
              <ToggleRow
                icon={<Users className="w-4 h-4" />}
                label="Friend Requests"
                description="When someone sends you a friend request"
                checked={preferences.email_friend_requests}
                onCheckedChange={toggle("email_friend_requests")}
              />
              <ToggleRow
                icon={<Users className="w-4 h-4" />}
                label="New Followers"
                description="When someone starts following you"
                checked={preferences.email_new_followers}
                onCheckedChange={toggle("email_new_followers")}
              />
              <ToggleRow
                icon={<Trophy className="w-4 h-4" />}
                label="Competition Updates"
                description="Results, approvals, and winner announcements"
                checked={preferences.email_competition_updates}
                onCheckedChange={toggle("email_competition_updates")}
              />
              <ToggleRow
                icon={<Gift className="w-4 h-4" />}
                label="Gift Credits & Badges"
                description="When you receive gift credits or earn a badge"
                checked={preferences.email_gift_credits}
                onCheckedChange={toggle("email_gift_credits")}
              />
              <ToggleRow
                icon={<Award className="w-4 h-4" />}
                label="Certificates"
                description="When a new certificate is issued to you"
                checked={preferences.email_certificates}
                onCheckedChange={toggle("email_certificates")}
              />
              <ToggleRow
                icon={<GraduationCap className="w-4 h-4" />}
                label="Course Updates"
                description="Updates about courses you're enrolled in"
                checked={preferences.email_course_updates}
                onCheckedChange={toggle("email_course_updates")}
              />
              <ToggleRow
                icon={<Mail className="w-4 h-4" />}
                label="Weekly Digest"
                description="A weekly summary of activity you may have missed"
                checked={preferences.email_weekly_digest}
                onCheckedChange={toggle("email_weekly_digest")}
              />
              <ToggleRow
                icon={<Heart className="w-4 h-4" />}
                label="We Miss You Emails"
                description="If you're away for 3+ days, we'll send up to 4 gentle nudges to bring you back"
                checked={preferences.email_reengagement}
                onCheckedChange={toggle("email_reengagement")}
              />

              {/* In-App Notifications */}
              <SectionHeader title="In-App Notifications" subtitle="Control notifications within the app" />
              <ToggleRow
                icon={<Heart className="w-4 h-4" />}
                label="Reactions"
                description="In-app alerts for reactions on your content"
                checked={preferences.inapp_reactions}
                onCheckedChange={toggle("inapp_reactions")}
              />
              <ToggleRow
                icon={<MessageSquare className="w-4 h-4" />}
                label="Comments & Replies"
                description="In-app alerts for comments and replies"
                checked={preferences.inapp_comments}
                onCheckedChange={toggle("inapp_comments")}
              />
              <ToggleRow
                icon={<Users className="w-4 h-4" />}
                label="Social Activity"
                description="Friend requests, follows, and social interactions"
                checked={preferences.inapp_social}
                onCheckedChange={toggle("inapp_social")}
              />
              <ToggleRow
                icon={<Trophy className="w-4 h-4" />}
                label="Competition Activity"
                description="Votes, results, and competition updates"
                checked={preferences.inapp_competitions}
                onCheckedChange={toggle("inapp_competitions")}
              />

              {/* Sound */}
              <SectionHeader title="Sound" />
              <ToggleRow
                icon={<Volume2 className="w-4 h-4" />}
                label="Notification Sound"
                description="Play a chime when new notifications arrive"
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
