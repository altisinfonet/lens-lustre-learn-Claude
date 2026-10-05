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
 *   4. the feed's first-page cache (localStorage `feed_cache_v1`).
 * NOT wiped, on purpose: device preferences that belong to the device, not the
 * member — theme, language, cookie consent, the device id.
 *
 * Never throws and never delays sign-out; each step is independent.
 */
import { purgeImageCache } from "@/lib/imageCachePurge";
import { clearDeviceStore } from "./deviceStore";
import { setPersistenceUser } from "./queryPersistence";
import { clearFeedCache } from "@/lib/feedCache";

export interface WipeResult {
  imageCaches: string[] | null;
  deviceStore: boolean;
  feedCache: boolean;
}

export async function wipeMemberDataOnSignOut(): Promise<WipeResult> {
  setPersistenceUser(null);
  let feedCache = false;
  try { clearFeedCache(); feedCache = true; } catch { /* never block sign-out */ }
  const [imageCaches, deviceStore] = await Promise.all([
    purgeImageCache().catch(() => null),
    clearDeviceStore().catch(() => false),
  ]);
  return { imageCaches, deviceStore, feedCache };
}
