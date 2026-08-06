import { supabase } from "@/integrations/supabase/client";
import { getOrCreateAutoAlbum, addPhotoToAlbum } from "@/hooks/profile/useAlbums";
import { logger } from "@/lib/logger";

const FILE = "src/lib/profilePostHelper.ts";

/**
 * Creates a wall post when a user updates their profile picture or cover photo,
 * AND adds the image to the corresponding auto-album (Profile Pictures / Cover Photos).
 */
export async function createProfileUpdatePost(
  userId: string,
  type: "avatar" | "cover",
  imageUrl: string,
  caption?: string
) {
  const defaultText =
    type === "avatar"
      ? "updated their profile picture."
      : "updated their cover photo.";
  const content = caption ? `${defaultText}\n\n${caption}` : defaultText;

  // 1. Create the wall post
  const { data: post, error } = await supabase.from("posts").insert({
    user_id: userId,
    content,
    image_url: imageUrl,
    image_urls: [imageUrl],
    privacy: "public",
  }).select("id").single();

  if (error) {
    logger.error({
      code: "POST-2006",
      event: "PROFILE_UPDATE_POST_FAILED",
      fn: "createProfileUpdatePost",
      file: FILE,
      message: "The post announcing a new profile or cover photo could not be created.",
      reason: error.message,
      expected: "One wall post announcing the change",
      actual: "The insert was refused",
      nextStep:
        "THE MEMBER'S PHOTO DID CHANGE — only the announcement failed. Do not tell them their photo did not save. Check the posts table policies.",
      userId,
      // The caption is the member's own words and is deliberately absent; its
      // length is enough to tell a plain update from a captioned one.
      detail: { photoType: type, captionLength: caption?.length ?? 0 },
    });
    return;
  }

  // 2. Add to auto-album (best-effort, don't block)
  try {
    const albumType = type === "avatar" ? "profile_pictures" : "cover_photos";
    const albumId = await getOrCreateAutoAlbum(userId, albumType as any);
    await addPhotoToAlbum(albumId, imageUrl, post?.id, caption);
  } catch (albumErr: any) {
    logger.warn({
      code: "POST-2007",
      event: "AUTO_ALBUM_ADD_FAILED",
      fn: "createProfileUpdatePost",
      file: FILE,
      message: "The new photo was not added to its automatic album.",
      reason: albumErr?.message ?? String(albumErr),
      expected: `The photo filed under the ${type === "avatar" ? "profile_pictures" : "cover_photos"} album`,
      actual: "The album step threw",
      nextStep:
        "Cosmetic — the photo and its post are both fine. Check getOrCreateAutoAlbum and the album policies.",
      userId,
      detail: { photoType: type },
    });
  }
}
