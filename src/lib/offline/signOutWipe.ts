/**
 * OFF-4 · everything the device holds for a member is wiped when the session ends.
 *
 * One function, called from useAuth's SIGNED_OUT branch — the path every session
 * end takes (the Log out button, a global sign-out, a deleted account, an
 * expired refresh, another tab signing out). Before OFF-4 these were scattered:
 * the image cache was purged there (F-D3-6) but the feed's localStorage page was
 * only cleared by the Log out BUTTON, so an involuntary sign-out left it behind.
 *
 * WHAT IS WIPED — member content only:
 *   1. the OFF-1 writer is stopped FIRST, synchronously, so no pending write can
 *      put the departed member's data back after the wipe;
 *   2. the image service worker's caches (gallery-images-*);
 *   3. the OFF-1 device store (IndexedDB `retina-offline`);
 *   4. the feed's first-page cache (localStorage `feed_cache_v1`), and the
 *      feed's in-memory session (lib/feedSessions: seed + exclude lists);
 *      and every comment thread drawn this session (lib/comments/threadCache:
 *      post AND ad threads), so the next viewer is never shown them;
 *   6. VID-1 video upload jobs + their encoded files (IndexedDB
 *      `retina-video-uploads`): an unposted video is the member's alone;
 *   5. the OFF-2 outbox (IndexedDB `retina-outbox`): unsent actions belong to
 *      the member who made them and are never sent under someone else.
 * NOT wiped, on purpose: device preferences that belong to the device, not the
 * member — theme, language, cookie consent, the device id.
 *
 * Never throws and never delays sign-out; each step is independent.
 */
import { purgeImageCache } from "@/lib/imageCachePurge";
import { clearDeviceStore } from "./deviceStore";
import { setPersistenceUser } from "./queryPersistence";
import { clearFeedCache } from "@/lib/feedCache";
import { clearFeedSessions } from "@/lib/feedSessions";
import { resetFeedArchiveMemory } from "./feedArchive";
import { resetSeenContent } from "./seenContent";
import { clearCommentThreadCaches } from "@/lib/comments/threadCache";
import { clearOutbox } from "./outbox";
import { clearVideoUploads } from "@/lib/video/uploadJobs";
import { clearPhotoUploads } from "@/lib/upload/photoJobs";

export interface WipeResult {
  imageCaches: string[] | null;
  deviceStore: boolean;
  feedCache: boolean;
  outbox: boolean;
  videoUploads: boolean;
}

export async function wipeMemberDataOnSignOut(): Promise<WipeResult> {
  setPersistenceUser(null);
  let feedCache = false;
  try { clearFeedCache(); feedCache = true; } catch { /* never block sign-out */ }
  // L1 · B1: the feed's session (seed, exclude lists) outlives the feed screen
  // so Back can keep the deal on screen — it must not outlive the member.
  clearFeedSessions();
  // Review of #435: the comment threads this member opened (post and ad) are
  // in memory too, and a sign-out does not reload the page.
  clearCommentThreadCaches();
  // S7b-3 review: the saved feed's pending save must stop BEFORE the device
  // store is wiped, or its timer writes the signed-out member's posts back.
  resetFeedArchiveMemory();
  // S7b-4 review: a post page / thread loading now is not saved after the wipe.
  resetSeenContent();
  const [imageCaches, deviceStore, outbox, videoUploads] = await Promise.all([
    purgeImageCache().catch(() => null),
    clearDeviceStore().catch(() => false),
    clearOutbox().catch(() => false),
    clearVideoUploads().catch(() => false),
    clearPhotoUploads().catch(() => false), // S5-b: the photo twin
  ]);
  return { imageCaches, deviceStore, feedCache, outbox, videoUploads };
}
