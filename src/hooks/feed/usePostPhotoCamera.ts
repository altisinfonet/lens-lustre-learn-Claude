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
  return usePostPhotoCameraRead(postId, enabled).rows;
}

/**
 * The rows plus `pending`: the read is still in flight (not failed, not off).
 * A FAILED read is not pending — the card stops holding the line's height
 * (CameraLine `reserve`) instead of leaving an empty gap for good.
 */
export function usePostPhotoCameraRead(postId: string, enabled: boolean): { rows: PhotoCameraRow[] | undefined; pending: boolean } {
  const q = useQuery({
    queryKey: postPhotoCameraKey(postId),
    enabled: enabled && !!postId,
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: () => loadPostPhotoCamera(postId),
  });
  return { rows: enabled ? q.data : undefined, pending: enabled && !!postId && q.status === "pending" };
}
