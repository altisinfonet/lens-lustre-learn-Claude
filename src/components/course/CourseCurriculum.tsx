import { CheckCircle, Circle, Lock, Play } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { isLessonUnlocked } from "@/utils/courseAccess";

const headingFont = { fontFamily: "var(--font-heading)" };
const bodyFont = { fontFamily: "var(--font-body)" };

interface Lesson {
  id: string;
  title: string;
  sort_order: number;
  module_id: string | null;
}

interface Module {
  id: string;
  title: string;
  sort_order: number;
  lessons: Lesson[];
}

interface CourseCurriculumProps {
  modules: Module[];
  completedLessons: Set<string>;
  enrolled: boolean;
  isFree: boolean;
  courseSlug: string;
  activeLessonId: string | null;
  /** Flat sorted lessons list used for sequential lock logic */
  allLessons?: { id: string; sort_order: number }[];
}

const CourseCurriculum = ({
  modules,
  completedLessons,
  enrolled,
  isFree,
  courseSlug,
  activeLessonId,
  allLessons,
}: CourseCurriculumProps) => {
  const navigate = useNavigate();
  const totalLessons = modules.reduce((sum, m) => sum + m.lessons.length, 0);
  const totalCompleted = modules.reduce(
    (sum, m) => sum + m.lessons.filter((l) => completedLessons.has(l.id)).length,
    0
  );

  // Use flat lessons for lock logic; fallback to module-derived list
  const flatLessons = allLessons || modules.flatMap((m) => m.lessons).sort((a, b) => a.sort_order - b.sort_order);

  return (
    <div>
      {/* Section header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-px bg-primary" />
          <span
            className="text-[10px] tracking-[0.3em] uppercase text-primary"
            style={headingFont}
          >
            Course Content
          </span>
        </div>
        <span className="text-xs text-muted-foreground" style={bodyFont}>
          {totalCompleted} / {totalLessons} completed
        </span>
      </div>

      {/* Accordion */}
      <Accordion
        type="multiple"
        defaultValue={modules.map((m) => m.id)}
        className="border border-border rounded-lg overflow-hidden"
      >
        {modules.map((mod, mi) => {
          const modCompleted = mod.lessons.filter((l) => completedLessons.has(l.id)).length;
          return (
            <AccordionItem key={mod.id} value={mod.id} className="border-b last:border-b-0">
              <AccordionTrigger className="px-5 py-4 hover:no-underline hover:bg-muted/20 transition-colors">
                <div className="flex items-center gap-3 flex-1 text-left">
                  <span
                    className="text-[9px] tracking-[0.15em] uppercase text-muted-foreground w-8"
                    style={headingFont}
                  >
                    {String(mi + 1).padStart(2, "0")}
                  </span>
                  <span className="text-sm font-medium flex-1" style={bodyFont}>
                    {mod.title}
                  </span>
                  <span
                    className="text-[10px] text-muted-foreground mr-2"
                    style={headingFont}
                  >
                    {modCompleted}/{mod.lessons.length}
                  </span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="pb-0">
                <div className="divide-y divide-border/50">
                  {mod.lessons.map((lesson, li) => {
                    const completed = completedLessons.has(lesson.id);
                    const unlocked = enrolled && isLessonUnlocked(lesson.id, flatLessons, completedLessons, enrolled);
                    const isActive = lesson.id === activeLessonId;
                    return (
                      <div
                        key={lesson.id}
                        className={`flex items-center gap-4 px-5 py-3.5 ${
                          isActive ? "bg-primary/10" : ""
                        } ${unlocked ? "hover:bg-muted/30 cursor-pointer" : "opacity-50 cursor-not-allowed"} transition-colors duration-200`}
                        onClick={() =>
                          unlocked && navigate(`/courses/${courseSlug}/lessons/${lesson.id}`)
                        }
                      >
                        <span
                          className="text-[10px] text-muted-foreground/50 w-6 text-center"
                          style={headingFont}
                        >
                          {String(li + 1).padStart(2, "0")}
                        </span>
                        {completed ? (
                          <CheckCircle className="h-4 w-4 text-primary shrink-0" />
                        ) : unlocked ? (
                          <Circle className="h-4 w-4 text-muted-foreground/30 shrink-0" />
                        ) : (
                          <Lock className="h-3.5 w-3.5 text-muted-foreground/30 shrink-0" />
                        )}
                        <span
                          className={`text-sm flex-1 ${isActive ? "font-medium text-primary" : ""}`}
                          style={bodyFont}
                        >
                          {lesson.title}
                        </span>
                        {isActive && unlocked && (
                          <span
                            className="text-[9px] tracking-[0.15em] uppercase text-primary px-2 py-0.5 border border-primary/30 rounded"
                            style={headingFont}
                          >
                            Continue
                          </span>
                        )}
                        {unlocked && !isActive && (
                          <Play className="h-3 w-3 text-muted-foreground/30" />
                        )}
                      </div>
                    );
                  })}
                </div>
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>
    </div>
  );
};

export default CourseCurriculum;
