import { calcProfileCompletion } from "@/lib/profileCompletion";
import { Progress } from "@/components/ui/progress";
import { CheckCircle2, Circle, Info } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useT } from "@/i18n/I18nContext";

interface Props {
  profile: Record<string, any>;
  className?: string;
  showSections?: boolean;
}

const ProfileCompletionBar = ({ profile, className = "" }: Props) => {
  const t = useT();
  const { total, sections } = calcProfileCompletion(profile);

  const color =
    total === 100
      ? "text-green-500"
      : total >= 60
      ? "text-yellow-500"
      : "text-destructive";

  return (
    <div className={className}>
      <div className="flex items-center justify-between mb-2">
        <span
          className="text-[10px] tracking-[0.2em] uppercase text-muted-foreground flex items-center gap-1.5"
          style={{ fontFamily: "var(--font-heading)" }}
        >
          {t("pc.title")}
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="text-muted-foreground hover:text-primary transition-colors"
                aria-label={t("pc.showDetails")}
              >
                <Info className="h-3.5 w-3.5" />
              </button>
            </PopoverTrigger>
            <PopoverContent side="bottom" align="start" className="w-64 p-3 text-xs space-y-1.5">
              {total === 100 ? (
                <p className="text-green-500 font-medium" style={{ fontFamily: "var(--font-body)" }}>
                  {t("pc.allDone")}
                </p>
              ) : (
                <>
                  <p className="text-muted-foreground mb-2" style={{ fontFamily: "var(--font-body)" }}>
                    {t("pc.completeThese")}
                  </p>
                  {sections.map((s) => (
                    <div key={s.label} className="flex items-center gap-1.5 text-muted-foreground">
                      {s.completed ? (
                        <CheckCircle2 className="h-3 w-3 text-green-500 flex-shrink-0" />
                      ) : (
                        <Circle className="h-3 w-3 text-muted-foreground/30 flex-shrink-0" />
                      )}
                      <span style={{ fontFamily: "var(--font-body)" }}>{t(s.labelKey, s.label)} ({s.percentage}%)</span>
                    </div>
                  ))}
                </>
              )}
            </PopoverContent>
          </Popover>
        </span>
        <span
          className={`text-sm font-semibold ${color}`}
          style={{ fontFamily: "var(--font-heading)" }}
        >
          {total}%
        </span>
      </div>
      <Progress value={total} className="h-2" />
    </div>
  );
};

export default ProfileCompletionBar;
