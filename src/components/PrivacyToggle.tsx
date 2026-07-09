import { Globe, Users, Lock } from "lucide-react";

export type PrivacyLevel = "public" | "friends" | "only_me";

interface PrivacyToggleProps {
  value: PrivacyLevel;
  onChange: (value: PrivacyLevel) => void;
  compact?: boolean;
}

const OPTIONS: { value: PrivacyLevel; icon: typeof Globe; label: string }[] = [
  { value: "public", icon: Globe, label: "Public" },
  { value: "friends", icon: Users, label: "Friends" },
  { value: "only_me", icon: Lock, label: "Only Me" },
];

const PrivacyToggle = ({ value, onChange, compact }: PrivacyToggleProps) => {
  const current = OPTIONS.find((o) => o.value === value) || OPTIONS[0];
  const CurrentIcon = current.icon;

  const cycle = () => {
    const idx = OPTIONS.findIndex((o) => o.value === value);
    const next = OPTIONS[(idx + 1) % OPTIONS.length];
    onChange(next.value);
  };

  return (
    <button
      type="button"
      onClick={cycle}
      className={`inline-flex items-center gap-1 text-[9px] tracking-[0.15em] uppercase px-2 py-1 border border-border rounded-sm hover:border-primary/50 transition-all duration-300 ${
        value === "public"
          ? "text-primary bg-primary/5"
          : value === "friends"
          ? "text-accent-foreground bg-accent/10"
          : "text-muted-foreground bg-muted/50"
      }`}
      style={{ fontFamily: "var(--font-heading)" }}
      title={`Visibility: ${current.label}. Click to change.`}
    >
      <CurrentIcon className="h-2.5 w-2.5" />
      {!compact && <span>{current.label}</span>}
    </button>
  );
};

export default PrivacyToggle;

export const DEFAULT_PRIVACY: Record<string, PrivacyLevel> = {
  avatar: "public",
  bio: "public",
  phone: "only_me",
  whatsapp: "only_me",
  email: "only_me",
  city_country: "public",
  social_links: "public",
  portfolio: "public",
  interests: "public",
  member_since: "only_me",
  pronouns: "public",
  workplace: "public",
  education: "public",
  certificates: "public",
};

export function getPrivacy(settings: Record<string, string> | null | undefined, field: string): PrivacyLevel {
  if (!settings || !settings[field]) return DEFAULT_PRIVACY[field] || "public";
  return settings[field] as PrivacyLevel;
}

export function canViewField(
  privacy: PrivacyLevel,
  isOwner: boolean,
  isFriend: boolean
): boolean {
  if (isOwner) return true;
  if (privacy === "public") return true;
  if (privacy === "friends" && isFriend) return true;
  return false;
}
