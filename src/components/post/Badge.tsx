import { motion } from "framer-motion";
import { Flame, Trophy, TrendingUp } from "lucide-react";
import type { PostBadgeType } from "@/lib/postAnalytics";

const CONFIG: Record<PostBadgeType, { icon: typeof Flame; label: string; className: string }> = {
  trending: { icon: Flame, label: "Trending", className: "bg-orange-500/10 text-orange-400" },
  top:      { icon: Trophy, label: "Top",      className: "bg-amber-500/10 text-amber-400" },
  rising:   { icon: TrendingUp, label: "Rising", className: "bg-blue-500/10 text-blue-400" },
};

interface BadgeProps {
  type: PostBadgeType;
}

const Badge = ({ type }: BadgeProps) => {
  const { icon: Icon, label, className } = CONFIG[type];
  return (
    <motion.span
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.25 }}
      className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${className}`}
    >
      <Icon className="h-3 w-3" />
      {label}
    </motion.span>
  );
};

export default Badge;
