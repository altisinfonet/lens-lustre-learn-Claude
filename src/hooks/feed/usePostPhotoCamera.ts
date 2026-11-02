/**
 * One post's camera details (photo plan U2). Batched underneath: every card
 * asking in the same tick shares one post_photo_camera_for call
 * (src/lib/photoCameraRead.ts). `enabled` false ⇒ nothing is asked at all —
 * the switch-off path makes no request.
 */
import { useQuery } from "@tanstack/react-query";
import { loadPostPhotoCamera } from "@/lib/photoCameraRead";
import type { PhotoCameraRow } from "@/lib/photoCameraDisplay";

export const postPhotoCameraKey = (postId: string) => ["post_photo_camera", postId] as const;

export function usePostPhotoCamera(postId: string, enabled: boolean): PhotoCameraRow[] | undefined {
  const q = useQuery({
    queryKey: postPhotoCameraKey(postId),
    enabled: enabled && !!postId,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: () => loadPostPhotoCamera(postId),
  });
  return enabled ? q.data : undefined;
}
