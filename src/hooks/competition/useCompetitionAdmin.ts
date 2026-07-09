import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/core/useAuth";
import { toast } from "@/hooks/core/use-toast";

interface POTDEntry {
  id: string;
  title: string;
  photos: string[];
  photo_thumbnails?: string[] | null;
  user_id: string;
  profiles: { full_name: string | null } | null;
}

export function useCompetitionAdmin() {
  const { user } = useAuth();

  const potdMutation = useMutation({
    mutationFn: async (entry: POTDEntry) => {
      if (!user) throw new Error("Not authenticated");
      const { error } = await supabase.from("photo_of_the_day").insert({
        image_url: entry.photos[0],
        thumbnail_url: entry.photo_thumbnails?.[0] || entry.photos[0],
        title: entry.title,
        photographer_name: entry.profiles?.full_name || null,
        photographer_id: entry.user_id,
        source_type: "competition_entry",
        source_entry_id: entry.id,
        created_by: user.id,
        is_active: true,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: "⭐ Marked as Photo of the Day!" });
    },
    onError: (err: any) => {
      toast({ title: "Failed", description: err.message, variant: "destructive" });
    },
  });

  return {
    markAsPOTD: (entry: POTDEntry) => potdMutation.mutate(entry),
    isMarkingPOTD: potdMutation.isPending,
  };
}
