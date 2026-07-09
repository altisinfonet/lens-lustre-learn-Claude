import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { Progress } from "@/components/ui/progress";

const headingFont = { fontFamily: "var(--font-heading)" };

interface LearningTopBarProps {
  courseTitle: string;
  courseSlug: string;
  completedCount: number;
  totalLessons: number;
  /** Pass null to hide/disable the Next button (locked or last lesson) */
  nextLessonId?: string | null;
}

const LearningTopBar = ({
  courseTitle,
  courseSlug,
  completedCount,
  totalLessons,
  nextLessonId,
}: LearningTopBarProps) => {
  const navigate = useNavigate();
  const progress = totalLessons > 0 ? Math.round((completedCount / totalLessons) * 100) : 0;

  return (
    <div className="sticky top-0 z-30 h-[52px] border-b border-border bg-card/80 backdrop-blur-sm flex items-center justify-between px-4 md:px-6 gap-4 shrink-0">
      {/* Left — Back to course */}
      <Link
        to={`/courses/${courseSlug}`}
        className="flex items-center gap-2 text-[9px] tracking-[0.15em] uppercase text-muted-foreground hover:text-foreground transition-colors shrink-0"
        style={headingFont}
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        <span className="hidden sm:inline truncate max-w-[180px]">{courseTitle}</span>
        <span className="sm:hidden">Back</span>
      </Link>

      {/* Center — Progress */}
      <div className="flex items-center gap-3 flex-1 max-w-xs mx-auto">
        <Progress value={progress} className="h-1.5 flex-1 bg-muted" />
        <span
          className="text-[10px] tracking-[0.15em] uppercase text-muted-foreground whitespace-nowrap"
          style={headingFont}
        >
          {completedCount} of {totalLessons}
        </span>
      </div>

      {/* Right — Next lesson (only if unlocked) */}
      {nextLessonId ? (
        <button
          onClick={() => navigate(`/courses/${courseSlug}/lessons/${nextLessonId}`)}
          className="flex items-center gap-1.5 text-[9px] tracking-[0.15em] uppercase text-muted-foreground hover:text-foreground transition-colors shrink-0"
          style={headingFont}
        >
          Next <ArrowRight className="h-3.5 w-3.5" />
        </button>
      ) : (
        <div className="w-16 shrink-0" />
      )}
    </div>
  );
};

export default LearningTopBar;
