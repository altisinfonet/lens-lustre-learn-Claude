import { useEffect, useRef } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowLeft, ArrowRight, CheckCircle, Circle, List, Lock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/core/useAuth";
import { Button } from "@/components/ui/button";
import { toast } from "@/hooks/core/use-toast";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { useCourseDetail } from "@/hooks/content/useCourses";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import LearningTopBar from "@/components/LearningTopBar";
import { isLessonUnlocked } from "@/utils/courseAccess";

const headingFont = { fontFamily: "var(--font-heading)" };
const bodyFont = { fontFamily: "var(--font-body)" };
const displayFont = { fontFamily: "var(--font-display)" };

const LessonView = () => {
  const { slug, lessonId } = useParams<{ slug: string; lessonId: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();
  const activeRef = useRef<HTMLButtonElement | null>(null);
  const queryClient = useQueryClient();

  const { data: courseData, isLoading: courseLoading } = useCourseDetail(slug, user?.id);

  const course = courseData?.course;
  const lessons = courseData?.lessons || [];
  const modules = courseData?.modules || [];
  const enrolled = courseData?.enrolled ?? false;
  const completedLessons = new Set(courseData?.completedLessonIds || []);

  const { data: lesson, isLoading: lessonLoading } = useQuery({
    queryKey: ["lesson-content", lessonId],
    queryFn: async () => {
      const { data, error } = await supabase
        .rpc("get_lesson_content", { _lesson_id: lessonId! })
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!lessonId,
  });

  // --- URL Guard: redirect if not enrolled or lesson locked ---
  useEffect(() => {
    if (courseLoading || !course) return;

    if (!enrolled) {
      navigate(`/courses/${slug}`, { replace: true });
      return;
    }

    if (lessonLoading || !lesson) return;

    const unlocked = isLessonUnlocked(lesson.id, lessons, completedLessons, enrolled);
    if (!unlocked) {
      toast({ title: "Complete the previous lesson first", variant: "destructive" });
      navigate(`/courses/${slug}`, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseLoading, lessonLoading, enrolled, lesson?.id, lessons.length]);

  const isCompleted = lesson ? completedLessons.has(lesson.id) : false;
  const currentIndex = lessons.findIndex((l) => l.id === lessonId);
  const prevLesson = currentIndex > 0 ? lessons[currentIndex - 1] : null;
  const nextLesson = currentIndex < lessons.length - 1 ? lessons[currentIndex + 1] : null;

  // Next lesson is only navigable if unlocked (i.e. current is completed)
  const nextLessonUnlocked = nextLesson
    ? isLessonUnlocked(nextLesson.id, lessons, completedLessons, enrolled)
    : false;

  const toggleComplete = async () => {
    if (!user || !lesson) return;
    const newVal = !isCompleted;

    const { data: existing } = await supabase
      .from("lesson_progress")
      .select("id")
      .eq("user_id", user.id)
      .eq("lesson_id", lesson.id)
      .maybeSingle();

    if (existing) {
      await supabase.from("lesson_progress").update({
        completed: newVal,
        completed_at: newVal ? new Date().toISOString() : null,
      }).eq("id", existing.id);
    } else {
      await supabase.from("lesson_progress").insert({
        user_id: user.id,
        lesson_id: lesson.id,
        completed: newVal,
        completed_at: newVal ? new Date().toISOString() : null,
      });
    }

    queryClient.invalidateQueries({ queryKey: queryKeys.courseDetail(slug || "") });
    toast({ title: newVal ? "Lesson marked complete!" : "Lesson unmarked" });
  };

  useEffect(() => {
    setTimeout(() => activeRef.current?.scrollIntoView({ block: "center", behavior: "smooth" }), 100);
  }, [lessonId]);

  if (courseLoading || lessonLoading) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground text-sm">Loading…</div>
      </main>
    );
  }

  if (!lesson || !course) {
    return (
      <main className="min-h-screen bg-background flex flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">Lesson not found.</p>
        <Link to="/courses" className="text-primary text-sm underline">Back to Courses</Link>
      </main>
    );
  }

  const progressPercent = lessons.length > 0
    ? Math.round((completedLessons.size / lessons.length) * 100)
    : 0;

  const renderLessonButton = (l: any, i: number) => {
    const completed = completedLessons.has(l.id);
    const unlocked = isLessonUnlocked(l.id, lessons, completedLessons, enrolled);
    const isActive = l.id === lessonId;

    return (
      <button
        key={l.id}
        ref={l.id === lessonId ? activeRef : null}
        onClick={() => unlocked && navigate(`/courses/${slug}/lessons/${l.id}`)}
        disabled={!unlocked}
        className={`w-full flex items-center gap-3 py-3 px-4 text-left text-sm border-b border-border last:border-b-0 transition-colors ${
          isActive
            ? "border-l-2 border-l-primary bg-primary/5 font-medium text-primary"
            : unlocked
            ? "border-l-2 border-l-transparent hover:bg-muted/30"
            : "border-l-2 border-l-transparent opacity-50 cursor-not-allowed"
        }`}
        style={bodyFont}
      >
        <span
          className="text-[10px] text-muted-foreground w-5 text-center shrink-0"
          style={headingFont}
        >
          {String(i + 1).padStart(2, "0")}
        </span>
        {completed ? (
          <CheckCircle className="h-3.5 w-3.5 text-primary shrink-0" />
        ) : unlocked ? (
          <Circle className="h-3 w-3 text-muted-foreground/40 shrink-0" />
        ) : (
          <Lock className="h-3 w-3 text-muted-foreground/30 shrink-0" />
        )}
        <span className="truncate">{l.title}</span>
      </button>
    );
  };

  const renderCurriculumItems = () => {
    if (modules.length > 1) {
      return modules.map((mod: any) => (
        <div key={mod.id}>
          <div
            className="px-4 py-2.5 text-[9px] tracking-[0.2em] uppercase text-muted-foreground border-b border-border bg-muted/20"
            style={headingFont}
          >
            {mod.title}
          </div>
          {mod.lessons.map((l: any, i: number) => renderLessonButton(l, i))}
        </div>
      ));
    }
    return lessons.map((l, i) => renderLessonButton(l, i));
  };

  // Find first incomplete & unlocked lesson for "Continue Learning"
  const continueLessonId = lessons.find(
    (l) => !completedLessons.has(l.id) && isLessonUnlocked(l.id, lessons, completedLessons, enrolled)
  )?.id || null;

  return (
    <main className="h-[calc(100vh-80px)] flex flex-col overflow-hidden bg-background text-foreground">
      <LearningTopBar
        courseTitle={course.title}
        courseSlug={slug || ""}
        completedCount={completedLessons.size}
        totalLessons={lessons.length}
        nextLessonId={nextLessonUnlocked ? nextLesson?.id || null : null}
      />

      <div className="flex flex-1 overflow-hidden">
        {/* Left Panel — Content */}
        <div className="flex-1 overflow-y-auto">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
            {/* Mobile curriculum toggle */}
            <div className="lg:hidden px-4 pt-4">
              <Sheet>
                <SheetTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-[9px] tracking-[0.1em] uppercase gap-2"
                    style={headingFont}
                  >
                    <List className="h-3.5 w-3.5" /> Curriculum
                  </Button>
                </SheetTrigger>
                <SheetContent side="right" className="w-[320px] p-0 overflow-y-auto">
                  <div className="p-4 border-b border-border">
                    <Link
                      to={`/courses/${slug}`}
                      className="text-[9px] tracking-[0.2em] uppercase text-muted-foreground hover:text-primary transition-colors"
                      style={headingFont}
                    >
                      {course.title}
                    </Link>
                    <div className="mt-2 text-[10px] text-muted-foreground" style={headingFont}>
                      {progressPercent}% complete
                    </div>
                  </div>
                  {renderCurriculumItems()}
                </SheetContent>
              </Sheet>
            </div>

            {/* Video */}
            {lesson.video_url && (
              <div className="aspect-video bg-black">
                <iframe
                  src={lesson.video_url}
                  title={lesson.title}
                  className="w-full h-full"
                  allowFullScreen
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                />
              </div>
            )}

            {/* Image */}
            {lesson.image_url && !lesson.video_url && (
              <div className="bg-black">
                <img loading="lazy" decoding="async"
                  src={lesson.image_url}
                  alt={lesson.title}
                  className="w-full object-cover max-h-[500px]"
                />
              </div>
            )}

            {/* Text content */}
            <div className="max-w-4xl mx-auto px-6 md:px-8 py-8 md:py-12">
              <span
                className="text-[10px] tracking-[0.2em] uppercase text-primary block mb-4"
                style={headingFont}
              >
                Lesson {currentIndex + 1} of {lessons.length}
              </span>

              <h1
                className="text-3xl md:text-5xl font-light tracking-tight mb-10 leading-[1.1]"
                style={displayFont}
              >
                {lesson.title}
              </h1>

              <div className="space-y-6 mb-12">
                {lesson.content?.split("\n\n").map((paragraph: string, i: number) => (
                  <p
                    key={i}
                    className="text-sm md:text-base text-foreground/85 leading-[1.8]"
                    style={bodyFont}
                  >
                    {paragraph}
                  </p>
                ))}
              </div>

              {/* Mark complete */}
              {user && enrolled && (
                <div className="border-t border-border pt-8 mb-12">
                  <Button
                    onClick={toggleComplete}
                    variant={isCompleted ? "default" : "outline"}
                    className={`text-xs tracking-[0.1em] uppercase ${
                      isCompleted ? "bg-primary text-primary-foreground" : ""
                    }`}
                    style={headingFont}
                  >
                    {isCompleted ? (
                      <CheckCircle className="h-4 w-4 mr-2" />
                    ) : (
                      <Circle className="h-4 w-4 mr-2" />
                    )}
                    {isCompleted ? "Completed" : "Mark as Complete"}
                  </Button>
                </div>
              )}

              {/* Prev / Next */}
              <div className="flex items-center justify-between border-t border-border pt-8 pb-8">
                {prevLesson ? (
                  <button
                    onClick={() => navigate(`/courses/${slug}/lessons/${prevLesson.id}`)}
                    className="flex items-center gap-2 text-xs tracking-[0.15em] uppercase text-muted-foreground hover:text-foreground transition-colors"
                    style={headingFont}
                  >
                    <ArrowLeft className="h-3.5 w-3.5" /> Previous
                  </button>
                ) : (
                  <div />
                )}
                {nextLesson ? (
                  <button
                    onClick={() =>
                      nextLessonUnlocked && navigate(`/courses/${slug}/lessons/${nextLesson.id}`)
                    }
                    disabled={!nextLessonUnlocked}
                    className={`flex items-center gap-2 text-xs tracking-[0.15em] uppercase transition-colors ${
                      nextLessonUnlocked
                        ? "text-muted-foreground hover:text-foreground"
                        : "text-muted-foreground/40 cursor-not-allowed"
                    }`}
                    style={headingFont}
                  >
                    Next <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                ) : (
                  <Link
                    to={`/courses/${slug}`}
                    className="text-xs tracking-[0.15em] uppercase text-primary hover:opacity-80 transition-opacity"
                    style={headingFont}
                  >
                    Back to Course
                  </Link>
                )}
              </div>
            </div>
          </motion.div>
        </div>

        {/* Right Panel — Curriculum Sidebar */}
        <div className="w-[360px] border-l border-border overflow-y-auto hidden lg:flex flex-col shrink-0">
          <div className="p-4 border-b border-border shrink-0">
            <Link
              to={`/courses/${slug}`}
              className="text-[9px] tracking-[0.2em] uppercase text-muted-foreground hover:text-primary transition-colors block mb-3"
              style={headingFont}
            >
              {course.title}
            </Link>
            <div className="flex items-center justify-between gap-3">
              <span className="text-[10px] tracking-[0.15em] uppercase text-muted-foreground" style={headingFont}>
                {progressPercent}% complete
              </span>
              {continueLessonId && continueLessonId !== lessonId && (
                <button
                  onClick={() => navigate(`/courses/${slug}/lessons/${continueLessonId}`)}
                  className="text-[9px] tracking-[0.15em] uppercase text-primary hover:text-primary/80 transition-colors"
                  style={headingFont}
                >
                  Continue →
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {renderCurriculumItems()}
          </div>
        </div>
      </div>
    </main>
  );
};

export default LessonView;
