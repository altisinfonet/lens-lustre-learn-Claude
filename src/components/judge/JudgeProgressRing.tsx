interface JudgeProgressRingProps {
  total: number;
  marked: number;
  size?: number;
  strokeWidth?: number;
  darkMode?: boolean;
}

const JudgeProgressRing = ({ total, marked, size = 80, strokeWidth = 6, darkMode = false }: JudgeProgressRingProps) => {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = total > 0 ? (marked / total) * 100 : 0;
  const offset = circumference - (progress / 100) * circumference;
  const remaining = total - marked;

  const textColor = darkMode ? "text-white" : "text-foreground";
  const mutedColor = darkMode ? "text-white/50" : "text-muted-foreground";
  const strokeBg = darkMode ? "rgba(255,255,255,0.15)" : "hsl(var(--muted))";
  const accentColor = darkMode ? "rgba(255,255,255,0.9)" : "hsl(var(--primary))";

  return (
    <div className="flex items-center gap-3">
      <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2} cy={size / 2} r={radius}
            fill="none" stroke={strokeBg} strokeWidth={strokeWidth}
          />
          <circle
            cx={size / 2} cy={size / 2} r={radius}
            fill="none" stroke={accentColor} strokeWidth={strokeWidth}
            strokeDasharray={circumference} strokeDashoffset={offset}
            strokeLinecap="round"
            className="transition-all duration-700 ease-out"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className={`text-xs font-bold tabular-nums ${textColor}`} style={{ fontFamily: "var(--font-heading)" }}>
            {Math.round(progress)}%
          </span>
        </div>
      </div>

      <div className="space-y-0.5 min-w-0">
        <div className="flex items-center justify-between gap-3 text-[10px]" style={{ fontFamily: "var(--font-heading)" }}>
          <span className={mutedColor}>Total</span>
          <span className={`font-bold tabular-nums ${textColor}`}>{total}</span>
        </div>
        <div className="flex items-center justify-between gap-3 text-[10px]" style={{ fontFamily: "var(--font-heading)" }}>
          <span className={darkMode ? "text-white/70" : ""} style={darkMode ? undefined : { color: "hsl(var(--progress-marked))" }}>Marked</span>
          <span className={`font-bold tabular-nums ${darkMode ? "text-white/70" : ""}`} style={darkMode ? undefined : { color: "hsl(var(--progress-marked))" }}>{marked}</span>
        </div>
        <div className="flex items-center justify-between gap-3 text-[10px]" style={{ fontFamily: "var(--font-heading)" }}>
          <span className={darkMode ? "text-white/50" : ""} style={darkMode ? undefined : { color: "hsl(var(--progress-remaining))" }}>Remaining</span>
          <span className={`font-bold tabular-nums ${darkMode ? "text-white/50" : ""}`} style={darkMode ? undefined : { color: "hsl(var(--progress-remaining))" }}>{remaining}</span>
        </div>
      </div>
    </div>
  );
};

export default JudgeProgressRing;
