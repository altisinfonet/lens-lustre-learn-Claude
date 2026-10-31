import { Award, Trophy, Star, Medal, Shield, CheckCircle, XCircle, Crown, Gem, Sparkles } from "lucide-react";

const ICON_MAP: Record<string, React.ComponentType<any>> = {
  award: Award,
  trophy: Trophy,
  star: Star,
  medal: Medal,
  shield: Shield,
  check: CheckCircle,
  reject: XCircle,
  crown: Crown,
  gem: Gem,
  sparkles: Sparkles,
};

export const STAMP_ICONS = Object.keys(ICON_MAP);

interface StampBadgeProps {
  label: string;
  color: string;
  icon?: string;
  imageUrl?: string | null;
  size?: "sm" | "md";
  className?: string;
}

const JudgingStampBadge = ({ label, color, icon = "award", imageUrl, size = "sm", className = "" }: StampBadgeProps) => {
  const IconComp = ICON_MAP[icon] || Award;
  const isSm = size === "sm";

  // If a custom image is uploaded, render image-based badge
  if (imageUrl) {
    return (
      <div
        className={`
          inline-flex items-center gap-1.5 select-none pointer-events-none
          ${isSm ? "px-1.5 py-0.5" : "px-2 py-1"}
          rounded-sm
          ${className}
        `}
        title={label}
      >
        <img loading="lazy" decoding="async"
          src={imageUrl}
          alt={label}
          className={`${isSm ? "h-6" : "h-10"} w-auto object-contain`}
          draggable={false}
        />
      </div>
    );
  }

  return (
    <div
      className={`
        inline-flex items-center gap-1 select-none pointer-events-none
        ${isSm ? "px-2 py-0.5" : "px-3 py-1"}
        rounded-sm border-2 bg-gradient-to-br
        shadow-[0_2px_8px_-2px_rgba(0,0,0,0.3)]
        ${className}
      `}
      style={{
        borderColor: color,
        background: `linear-gradient(135deg, ${color}18, ${color}30)`,
        boxShadow: `0 2px 10px -3px ${color}60, inset 0 1px 2px ${color}20`,
      }}
    >
      <IconComp
        className={isSm ? "h-3 w-3" : "h-4 w-4"}
        style={{ color }}
      />
      <span
        className={`font-semibold uppercase tracking-wider ${isSm ? "text-[8px]" : "text-[10px]"}`}
        style={{ color, fontFamily: "var(--font-heading)" }}
      >
        {label}
      </span>
    </div>
  );
};

export default JudgingStampBadge;
