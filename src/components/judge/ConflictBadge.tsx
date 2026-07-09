import { AlertTriangle } from "lucide-react";

interface ConflictBadgeProps {
  scores: { judge_id: string; score: number }[];
  threshold?: number;
}

const ConflictBadge = ({ scores, threshold = 4 }: ConflictBadgeProps) => {
  if (scores.length < 2) return null;
  
  const min = Math.min(...scores.map(s => s.score));
  const max = Math.max(...scores.map(s => s.score));
  const spread = max - min;
  
  if (spread < threshold) return null;
  
  return (
    <span
      className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-orange-500/15 text-orange-500 text-[8px] font-semibold"
      title={`Score conflict: spread of ${spread} (${min}–${max})`}
      style={{ fontFamily: "var(--font-heading)" }}
    >
      <AlertTriangle className="h-2.5 w-2.5" />
      ±{spread}
    </span>
  );
};

export default ConflictBadge;
