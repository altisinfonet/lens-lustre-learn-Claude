import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const useCourseStats = (courseId: string | undefined) => {
  return useQuery({
    queryKey: ["course-stats", courseId],
    queryFn: async () => {
      const { count } = await supabase
        .from("course_enrollments")
        .select("*", { count: "exact", head: true })
        .eq("course_id", courseId!);

      return { students: count || 0 };
    },
    enabled: !!courseId,
    staleTime: 60_000,
  });
};
