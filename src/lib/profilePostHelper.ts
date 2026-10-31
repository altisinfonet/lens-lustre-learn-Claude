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

  // 1. Create the wall post.
  //
  // ⚠ THIS IS A **SYSTEM** POST AND MUST GO THROUGH create_system_post().
  //
  // Phase B (2026-08-12) requires 1–5 categories on every MEMBER post. Nobody
  // picked a category here — the member changed their profile photo, they did
  // not compose anything. A direct `.from("posts").insert(...)` runs as
  // `authenticated`, so the trigger pins post_kind to 'member' and then refuses
  // the row with POST-CAT-002. The announcement would silently stop appearing.
  //
  // `create_system_post` is SECURITY DEFINER, takes no post_kind and no
  // categories parameter, and always writes user_id = auth.uid() — so there is
  // nothing here for a caller to forge. It is the ONLY way to make a system post.
  const { data: postId, error } = await (
    supabase.rpc as unknown as (
      fn: string,
      args: Record<string, unknown>,
    ) => Promise<{ data: string | null; error: { message: string } | null }>
  )("create_system_post", {
    _content: content,
    _image_url: imageUrl,
    _image_urls: [imageUrl],
    _thumbnail_urls: null,
    // ⚠ NULL, DELIBERATELY, AND IT WILL STAY NULL.
    //
    // Every other write surface now registers its photographs with the media
    // engine. This one cannot, and the reason is not laziness — it is what the
    // post MEANS.
    //
    // The URL here is `avatars/<owner>/avatar.webp?t=…` (or cover.webp), which
    // is MUTABLE: it is overwritten in place on every profile-photo change, and
    // the announcement is *supposed* to show whatever the member's picture is
    // now. A media object is a promise that a sha256 describes the bytes at a
    // key; for this key that promise is false the moment they change it again.
    // `media_mark_ready` refuses the path outright (MEDIA-2102), and
    // `media-register-upload` refuses it again by name.
    //
    // So these posts are legacy-only BY DESIGN, permanently. What changed today
    // is that they are no longer legacy-only SILENTLY — MEDIA-4007 below counts
    // every one, so the delta stays explainable rather than merely small.
    _media_ids: null,
  });
  const post = postId ? { id: postId } : null;

  if (post) {
    reportPermanentLegacyOnly(
      type === "avatar" ? "profile-picture announcement" : "cover-photo announcement",
    );
  }

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

/**
 * Count a post that is legacy-only and always will be.
 *
 * ⚠ THIS IS NOT MEDIA-4001, AND THE DIFFERENCE MATTERS.
 *
 * MEDIA-4001 means "the media path was tried and did not complete" — a
 * regression, something to investigate, a number that should trend to zero.
 * MEDIA-4007 means "this post can never carry media references, and here is
 * one more of them" — expected, permanent, and useful only as an explanation
 * of why the legacy-only population has a floor above zero.
 *
 * Filing both under one code would make a healthy floor look like a growing
 * fault, and the first time that happened someone would raise the threshold
 * and stop reading either.
 */
function reportPermanentLegacyOnly(kind: string): void {
  logger.warn({
    code: "MEDIA-4007",
    event: "POST_PERMANENTLY_LEGACY_ONLY",
    fn: "createProfileUpdatePost",
    file: FILE,
    message: "A post was created that can never carry media references.",
    reason: `${kind}: the image is a mutable avatar/cover object, so it cannot carry stable content identity.`,
    expected: "No media_objects/post_media rows — this is correct, not a failure",
    actual: "image_urls only",
    nextStep:
      "NOTHING TO FIX. This is the documented floor of the legacy-only population. It changes only if the product decides profile-update announcements should snapshot the image to an immutable path instead of pointing at the live avatar.",
  });
}
