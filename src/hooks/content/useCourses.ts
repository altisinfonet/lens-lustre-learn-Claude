import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { profilesPublic } from "@/lib/profilesPublic";
import { queryKeys } from "@/lib/queryKeys";

export interface CourseListItem {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  cover_image_url: string | null;
  category: string;
  difficulty: string;
  price: number | null;
  is_free: boolean;
  published_at: string | null;
  author_id?: string;
  author_name?: string | null;
  lesson_count?: number;
  is_featured?: boolean;
  labels?: string[];
  admin_students: number;
  admin_rating: number;
  admin_rating_count: number;
  reviews_enabled: boolean;
}

export const useCourses = () => {
  const queryClient = useQueryClient();

  useEffect(() => {
    const channel = supabase
      .channel("courses-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "courses" },
        () => {
          queryClient.invalidateQueries({ queryKey: queryKeys.courses() });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  return useQuery({
    queryKey: queryKeys.courses(),
    queryFn: async (): Promise<CourseListItem[]> => {
      const { data, error } = await supabase
        .from("courses")
        .select("id, title, slug, description, cover_image_url, category, difficulty, price, is_free, published_at, author_id, is_featured, labels, admin_students, admin_rating, admin_rating_count")
        .eq("status", "published")
        .order("is_featured", { ascending: false })
        .order("published_at", { ascending: false });

      if (error) throw error;
      if (!data) return [];

      const authorIds = [...new Set(data.map((c: any) => c.author_id))];
      const [{ data: profiles }, { data: lessons }] = await Promise.all([
        profilesPublic().select("id, full_name").in("id", authorIds),
        supabase.from("lessons").select("id, course_id"),
      ]);

      const profileMap = new Map(profiles?.map((p) => [p.id, p.full_name]) || []);
      const lessonCounts = new Map<string, number>();
      lessons?.forEach((l) => {
        lessonCounts.set(l.course_id, (lessonCounts.get(l.course_id) || 0) + 1);
      });

      return data.map((c: any) => ({
        ...c,
        author_name: profileMap.get(c.author_id),
        lesson_count: lessonCounts.get(c.id) || 0,
      }));
    },
  });
};

export const useCourseDetail = (slug: string | undefined, userId: string | undefined) => {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!slug) return;
    const channel = supabase
      .channel(`enrollment-realtime-${slug}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "course_enrollments" },
        () => {
          queryClient.invalidateQueries({ queryKey: queryKeys.courseDetail(slug) });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [slug, queryClient]);

  return useQuery({
    queryKey: queryKeys.courseDetail(slug || ""),
    queryFn: async () => {
      // Try by slug first, then fallback to ID (certificates store course UUID as reference_id)
      let courseData = null;
      let error = null;

      const slugResult = await supabase
        .from("courses")
        .select("*")
        .eq("slug", slug)
        .eq("status", "published")
        .maybeSingle();
      
      courseData = slugResult.data;
      error = slugResult.error;

      if (!courseData && !error && slug) {
        const idResult = await supabase
          .from("courses")
          .select("*")
          .eq("id", slug)
          .eq("status", "published")
          .maybeSingle();
        courseData = idResult.data;
        error = idResult.error;
      }

      if (error) throw error;
      if (!courseData) return null;

      const [{ data: lessonData }, { data: profile }, { data: moduleData }] = await Promise.all([
        supabase.from("lessons").select("id, title, sort_order, module_id").eq("course_id", courseData.id).order("sort_order"),
        profilesPublic().select("full_name").eq("id", courseData.author_id).maybeSingle(),
        supabase.from("course_modules").select("*").eq("course_id", courseData.id).order("sort_order", { ascending: true }),
      ]);

      let enrolled = false;
      let completedLessonIds: string[] = [];
      let hasCertificate = false;

      if (userId) {
        const [{ data: enrollment }, { data: progress }, { data: certData }] = await Promise.all([
          supabase.from("course_enrollments").select("id").eq("user_id", userId).eq("course_id", courseData.id).maybeSingle(),
          supabase.from("lesson_progress").select("lesson_id").eq("user_id", userId).eq("completed", true),
          supabase.from("certificates").select("id").eq("user_id", userId).eq("reference_id", courseData.id).eq("type", "course_completion").maybeSingle(),
        ]);
        enrolled = !!enrollment;
        hasCertificate = !!certData;
        const lessonIds = new Set((lessonData || []).map((l) => l.id));
        completedLessonIds = progress?.filter((p) => lessonIds.has(p.lesson_id)).map((p) => p.lesson_id) || [];
      }

      const lessons = (lessonData || []) as { id: string; title: string; sort_order: number; module_id: string | null }[];

      const modulesWithLessons = (moduleData || []).map((mod: any) => ({
        ...mod,
        lessons: lessons.filter((l) => l.module_id === mod.id),
      }));

      const safeModules = modulesWithLessons.length > 0
        ? modulesWithLessons
        : [{ id: "fallback", title: "General", sort_order: 0, lessons }];

      return {
        course: courseData as CourseListItem & { author_id: string },
        lessons,
        modules: safeModules,
        authorName: profile?.full_name || null,
        enrolled,
        completedLessonIds,
        hasCertificate,
      };
    },
    enabled: !!slug,
  });
};
