import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import JudgingStampBadge from "./JudgingStampBadge";
import { participantLabelForJudgingTag } from "@/lib/judging/participantStageLabels";

interface TagInfo {
  id: string;
  label: string;
  color: string;
  icon: string;
  image_url: string | null;
}

interface Props {
  entryId: string;
  photoIndex?: number;
  className?: string;
}

const normalizePhotoIndex = (value: unknown): number => {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  const parsed = Number.parseInt(String(value ?? 0), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

/**
 * Displays one final judging tag per image (entry + photo_index).
 * If multiple tag rows exist, it shows only the latest assignment.
 */
const EntryTagStamps = ({ entryId, photoIndex = 0, className = "" }: Props) => {
  const [tags, setTags] = useState<TagInfo[]>([]);
  const normalizedPhotoIndex = normalizePhotoIndex(photoIndex);

  const fetchTags = useCallback(async () => {
    // HOTFIX-G: read from publish-gated owner-safe view. Returns zero rows
    // until competition_round_publish.published_at is set, so participant
    // stamps stay hidden until the admin formally declares the round.
    const { data: assignments } = await supabase
      .from("judge_tag_assignments_owner_safe" as any)
      .select("tag_id, photo_index, created_at")
      .eq("entry_id", entryId)
      .eq("photo_index", normalizedPhotoIndex)
      .order("created_at", { ascending: false })
      .limit(1);

    const latestAssignment = (assignments as any)?.[0];
    if (!latestAssignment) {
      setTags([]);
      return;
    }

    const { data } = await supabase
      .from("judging_tags" as any)
      .select("id, label, color, icon, image_url")
      .eq("id", latestAssignment.tag_id)
      .maybeSingle();

    const tagData = data as any;
    if (!tagData) {
      setTags([]);
      return;
    }

    setTags([
      {
        id: tagData.id,
        label: tagData.label,
        color: tagData.color,
        icon: tagData.icon || "award",
        image_url: tagData.image_url || null,
      },
    ]);
  }, [entryId, normalizedPhotoIndex]);

  useEffect(() => {
    fetchTags();

    // Listen for realtime changes to tag assignments for this entry photo
    const channel = supabase
      .channel(`entry-tags-${entryId}-${normalizedPhotoIndex}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "judge_tag_assignments",
          filter: `entry_id=eq.${entryId}`,
        },
        (payload) => {
          const changedPhotoIndex = normalizePhotoIndex((payload.new as any)?.photo_index ?? (payload.old as any)?.photo_index);
          if (changedPhotoIndex === normalizedPhotoIndex) fetchTags();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [entryId, normalizedPhotoIndex, fetchTags]);

  if (tags.length === 0) return null;

  return (
    <div className={`absolute bottom-0 left-0 right-0 flex items-center gap-1.5 px-2 py-1.5 bg-gradient-to-t from-black/70 to-transparent z-10 ${className}`}>
      {tags.map((tag) => (
        <JudgingStampBadge
          key={tag.id}
          label={participantLabelForJudgingTag(tag.label)}
          color={tag.color}
          icon={tag.icon}
          imageUrl={tag.image_url}
          size="sm"
        />
      ))}
    </div>
  );
};

export default EntryTagStamps;
