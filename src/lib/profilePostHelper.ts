import { supabase } from "@/integrations/supabase/client";
import { getOrCreateAutoAlbum, addPhotoToAlbum } from "@/hooks/profile/useAlbums";

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
    console.error("Failed to create profile update post:", error.message);
    return;
  }

  // 2. Add to auto-album (best-effort, don't block)
  try {
    const albumType = type === "avatar" ? "profile_pictures" : "cover_photos";
    const albumId = await getOrCreateAutoAlbum(userId, albumType as any);
    await addPhotoToAlbum(albumId, imageUrl, post?.id, caption);
  } catch (albumErr: any) {
    console.warn("Failed to add to album:", albumErr?.message);
  }
}
