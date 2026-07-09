import { Briefcase, GraduationCap, MapPin, User } from "lucide-react";

const bodyFont = { fontFamily: "var(--font-body)" };

interface Props {
  pronouns?: string | null;
  currentCity?: string | null;
  workplace?: string | null;
  education?: string | null;
}

const ProfileIntro = ({ pronouns, currentCity, workplace, education }: Props) => {
  const items = [
    pronouns && { icon: User, text: pronouns },
    currentCity && { icon: MapPin, text: `Lives in ${currentCity}` },
    workplace && { icon: Briefcase, text: workplace },
    education && { icon: GraduationCap, text: `Studied at ${education}` },
  ].filter(Boolean) as { icon: any; text: string }[];

  if (items.length === 0) return null;

  return (
    <div className="space-y-2">
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-2.5 text-xs text-muted-foreground">
          <item.icon className="h-3.5 w-3.5 text-muted-foreground/60 flex-shrink-0" />
          <span style={bodyFont}>{item.text}</span>
        </div>
      ))}
    </div>
  );
};

export default ProfileIntro;
