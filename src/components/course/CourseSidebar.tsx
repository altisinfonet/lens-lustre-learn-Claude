import { Award, BookOpen, CheckCircle, GraduationCap, Play } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { formatUSDFixed } from "@/lib/currencyFormat";

const headingFont = { fontFamily: "var(--font-heading)" };
const bodyFont = { fontFamily: "var(--font-body)" };

interface Lesson {
  id: string;
  title: string;
  sort_order: number;
}

interface CourseSidebarProps {
  course: {
    id: string;
    title: string;
    slug: string;
    is_free: boolean;
    price: number | null;
    difficulty: string;
    category: string;
  };
  lessons: Lesson[];
  enrolled: boolean;
  enrolling: boolean;
  balance: number;
  completedLessons: Set<string>;
  hasCertificate: boolean;
  issuingCert: boolean;
  onEnroll: () => void;
  onClaimCertificate: () => void;
}

const CourseSidebar = ({
  course,
  lessons,
  enrolled,
  enrolling,
  balance,
  completedLessons,
  hasCertificate,
  issuingCert,
  onEnroll,
  onClaimCertificate,
}: CourseSidebarProps) => {
  const navigate = useNavigate();
  const progressPercent =
    lessons.length > 0 ? Math.round((completedLessons.size / lessons.length) * 100) : 0;
  const courseComplete = progressPercent === 100 && lessons.length > 0;

  const nextLesson = lessons.find((l) => !completedLessons.has(l.id)) || lessons[0];

  return (
    <div className="sticky top-24">
      <div className="border border-border rounded-xl p-6 bg-card shadow-sm">

        {/* CTA Button */}
        {!enrolled ? (
          <div className="mb-5">
            <Button
              onClick={onEnroll}
              disabled={enrolling}
              className="w-full text-xs tracking-[0.15em] uppercase py-6 text-base"
              style={headingFont}
            >
              <GraduationCap className="h-4 w-4 mr-2" />
              {enrolling
                ? "Enrolling…"
                : course.is_free
                ? "Start Learning"
                : `Enroll for ${formatUSDFixed(course.price ?? 0)}`}
            </Button>
            {!course.is_free && course.price && (
              <p className="text-[10px] text-muted-foreground text-center mt-2" style={bodyFont}>
                Wallet balance: {formatUSDFixed(balance)}
              </p>
            )}
          </div>
        ) : (
          <div className="mb-5">
            <Button
              onClick={() =>
                nextLesson && navigate(`/courses/${course.slug}/lessons/${nextLesson.id}`)
              }
              className="w-full text-xs tracking-[0.15em] uppercase py-6 text-base"
              style={headingFont}
            >
              <Play className="h-4 w-4 mr-2" />
              {completedLessons.size === 0 ? "Start Learning" : "Continue Learning"}
            </Button>
            <div className="flex items-center justify-center gap-2 mt-2">
              <CheckCircle className="h-3.5 w-3.5 text-primary" />
              <span className="text-xs text-primary" style={headingFont}>
                Enrolled
              </span>
            </div>
          </div>
        )}

        {/* Progress (if enrolled) */}
        {enrolled && lessons.length > 0 && (
          <div className="mb-5 pb-5 border-b border-border">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[9px] tracking-[0.2em] uppercase text-muted-foreground" style={headingFont}>
                Progress
              </span>
              <span className="text-xs text-primary" style={headingFont}>
                {progressPercent}%
              </span>
            </div>
            <Progress value={progressPercent} className="h-1.5" />
            <p className="text-[10px] text-muted-foreground mt-2" style={bodyFont}>
              {completedLessons.size} of {lessons.length} lessons completed
            </p>

            {courseComplete && (
              <div className="mt-4 space-y-3">
                <div className="flex items-center gap-2 text-primary">
                  <GraduationCap className="h-4 w-4" />
                  <span className="text-xs" style={headingFont}>
                    Course Complete!
                  </span>
                </div>
                {hasCertificate ? (
                  <Link
                    to="/certificates"
                    className="flex items-center gap-2 text-xs tracking-[0.1em] uppercase text-primary hover:opacity-80 transition-opacity"
                    style={headingFont}
                  >
                    <Award className="h-3.5 w-3.5" /> View Certificate
                  </Link>
                ) : (
                  <button
                    onClick={onClaimCertificate}
                    disabled={issuingCert}
                    className="flex items-center gap-2 text-xs tracking-[0.1em] uppercase px-4 py-2 bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50 rounded-md w-full justify-center"
                    style={headingFont}
                  >
                    <Award className="h-3.5 w-3.5" />
                    {issuingCert ? "Issuing…" : "Claim Certificate"}
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Course info */}
        <div className="space-y-3">
          <div className="flex justify-between text-xs text-muted-foreground" style={bodyFont}>
            <span>Lessons</span>
            <span className="font-medium text-foreground">{lessons.length}</span>
          </div>
          <div className="flex justify-between text-xs text-muted-foreground" style={bodyFont}>
            <span>Difficulty</span>
            <span className="font-medium text-foreground">{course.difficulty}</span>
          </div>
          <div className="flex justify-between text-xs text-muted-foreground" style={bodyFont}>
            <span>Category</span>
            <span className="font-medium text-foreground">{course.category}</span>
          </div>
          <div className="flex justify-between text-xs text-muted-foreground" style={bodyFont}>
            <span>Access</span>
            <span className="font-medium text-foreground">
              {course.is_free ? "Free" : "Lifetime"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CourseSidebar;
