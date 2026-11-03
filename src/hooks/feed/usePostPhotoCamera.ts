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
  // `isLoading` = pending AND actually fetching. Offline, react-query PAUSES the
  // read (networkMode "online"): status stays "pending" but nothing is coming,
  // so the line's height must not be held — an empty 28 px band under the photo
  // for as long as the phone is offline (Owner report, 3 Nov). Back online the
  // read resumes and the line appears if the photo has details.
  return { rows: enabled ? q.data : undefined, pending: enabled && !!postId && q.isLoading };
}
