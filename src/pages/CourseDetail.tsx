import { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import PageSEO from "@/components/PageSEO";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/core/useAuth";
import { useWallet } from "@/hooks/wallet/useWallet";
import { toast } from "@/hooks/core/use-toast";
import { formatUSDFixed } from "@/lib/currencyFormat";
import { useCourseDetail } from "@/hooks/content/useCourses";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";

import CourseHero from "@/components/course/CourseHero";
import CourseCurriculum from "@/components/course/CourseCurriculum";
import CourseSidebar from "@/components/course/CourseSidebar";
import CourseDescription from "@/components/course/CourseDescription";
import Breadcrumbs from "@/components/Breadcrumbs";

const CourseDetail = () => {
  const { slug } = useParams<{ slug: string }>();
  const { user } = useAuth();
  const { balance, refresh: refreshWallet } = useWallet();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: courseData, isLoading: loading } = useCourseDetail(slug, user?.id);

  const course = courseData?.course || null;
  const lessons = courseData?.lessons || [];
  const modules = courseData?.modules || [];
  const authorName = courseData?.authorName || null;
  const [enrolled, setEnrolled] = useState(false);
  const [completedLessons, setCompletedLessons] = useState<Set<string>>(new Set());
  const [enrolling, setEnrolling] = useState(false);
  const [hasCertificate, setHasCertificate] = useState(false);
  const [issuingCert, setIssuingCert] = useState(false);

  useEffect(() => {
    if (courseData) {
      setEnrolled(courseData.enrolled);
      setCompletedLessons(new Set(courseData.completedLessonIds));
      setHasCertificate(courseData.hasCertificate);
    }
  }, [courseData]);

  const handleEnroll = async () => {
    if (!user) { navigate("/login"); return; }
    if (!course) return;

    if (!course.is_free && course.price && course.price > 0) {
      if (balance < course.price) {
        toast({ title: "Insufficient balance", description: `You need ${formatUSDFixed(course.price)} but your wallet has ${formatUSDFixed(balance)}. Please top up first.`, variant: "destructive" });
        return;
      }
    }

    setEnrolling(true);
    try {
      const { data, error } = await supabase.rpc("enroll_in_course", {
        _user_id: user.id,
        _course_id: course.id,
      });

      if (error) throw error;

      setEnrolled(true);
      toast({ title: "Enrolled successfully!" });
      queryClient.invalidateQueries({ queryKey: queryKeys.courseDetail(slug || "") });
      refreshWallet();
    } catch (err: any) {
      const msg = err.message || "Enrollment failed";
      toast({ title: "Enrollment failed", description: msg, variant: "destructive" });
    } finally {
      setEnrolling(false);
    }
  };

  const handleClaimCertificate = async () => {
    if (!user || !course || hasCertificate) return;
    const courseComplete = lessons.length > 0 && completedLessons.size === lessons.length;
    if (!courseComplete) return;
    setIssuingCert(true);
    const { error } = await supabase.rpc("issue_course_completion_certificate", {
      _course_id: course.id,
    });
    if (error) {
      toast({ title: "Failed to issue certificate", description: error.message, variant: "destructive" });
    } else {
      setHasCertificate(true);
      toast({ title: "🎉 Certificate earned!", description: "View it in your certificates page." });
    }
    setIssuingCert(false);
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-background flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground text-sm">Loading…</div>
      </main>
    );
  }

  if (!course) {
    return (
      <main className="min-h-screen bg-background flex flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">Course not found.</p>
        <Link to="/courses" className="text-primary text-sm underline">Back to Courses</Link>
      </main>
    );
  }

  const activeLessonId = enrolled && completedLessons.size > 0
    ? (lessons.find((l) => !completedLessons.has(l.id))?.id || lessons[lessons.length - 1]?.id)
    : null;

  return (
    <main className="min-h-screen bg-background text-foreground">
      <PageSEO
        title={course.title}
        description={course.description || undefined}
        ogImage={course.cover_image_url || undefined}
        jsonLd={{
          type: "Course",
          name: course.title,
          description: course.description || undefined,
          image: course.cover_image_url || undefined,
          difficulty: course.difficulty,
        }}
      />

      <div className="container mx-auto pt-3 pb-0">
        <Breadcrumbs items={[
          { label: "Courses", to: "/courses" },
          { label: course.title },
        ]} className="mb-3" />
      </div>

      {/* Hero */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6 }}>
        <CourseHero
          courseId={course.id}
          title={course.title}
          description={course.description}
          category={course.category}
          difficulty={course.difficulty}
          lessonCount={lessons.length}
          isFree={course.is_free}
          price={course.price}
          authorId={course.author_id}
          authorName={authorName}
          coverImageUrl={course.cover_image_url}
          adminStudents={course.admin_students ?? 0}
          adminRating={Number(course.admin_rating) || 0}
          adminRatingCount={course.admin_rating_count ?? 0}
        />
      </motion.div>

      {/* Body grid */}
      <div className="max-w-7xl mx-auto px-6 py-8 md:py-12">
        <div className="grid lg:grid-cols-3 gap-6 md:gap-12 lg:gap-16">
          {/* Main content */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15, duration: 0.6 }}
            className="lg:col-span-2"
          >
            <CourseCurriculum
              modules={modules}
              completedLessons={completedLessons}
              enrolled={enrolled}
              isFree={course.is_free}
              courseSlug={course.slug}
              activeLessonId={activeLessonId}
              allLessons={lessons}
            />

            <CourseDescription description={course.description} />
          </motion.div>

          {/* Sidebar */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.6 }}
          >
            <CourseSidebar
              course={course}
              lessons={lessons}
              enrolled={enrolled}
              enrolling={enrolling}
              balance={balance}
              completedLessons={completedLessons}
              hasCertificate={hasCertificate}
              issuingCert={issuingCert}
              onEnroll={handleEnroll}
              onClaimCertificate={handleClaimCertificate}
            />
          </motion.div>
        </div>
      </div>
    </main>
  );
};

export default CourseDetail;
