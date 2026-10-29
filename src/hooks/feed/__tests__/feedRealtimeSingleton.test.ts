/**
 * ONE `feed-live` CHANNEL PER CLIENT, NOT TWO.
 *
 * `/feed` mounts `useFeedRealtime` twice — directly from `Feed.tsx`, and again
 * through `<WallPosts composerOnly>`, whose `composerOnly` flag gates only the
 * JSX and never the hook. The channel name is the fixed string "feed-live", so
 * supabase-js produced two channel objects on one topic: every event processed
 * twice, and `removeChannel` on either one tearing the topic out from under the
 * other.
 *
 * (Before S6-b) `useIsPrimaryInstance` existed for precisely this and was already applied to
 * the notification bell. This asserts it is applied to the feed hook too, and
 * that the effect re-runs when leadership moves — otherwise a promoted instance
 * would never subscribe and the feed would go silent instead of duplicating.
 *
 * Source assertions rather than a render test: the duplication only appears
 * when two *different* components mount the hook on a real page, which a unit
 * render cannot reproduce faithfully. Comments are stripped first so the
 * explanation above cannot satisfy the assertions.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { stripComments } from "@/test-utils/sourceText";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const code = (p: string) => stripComments(read(p))
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

const hook = code("src/hooks/feed/useRealtimeFeed.ts");

// S6-b (2026-10-29): the election is replaced by ONE shared channel owned by
// src/lib/realtime/feedLive.ts — every consumer registers with it, so two
// mounts can neither duplicate the topic nor leave the feed deaf.
const live = code("src/lib/realtime/feedLive.ts");
const feedHook = hook.slice(
  hook.indexOf("export function useFeedRealtime"),
  hook.indexOf("export function useNotificationRealtime"),
);

describe("the feed realtime channel is a singleton per client", () => {
  it("useFeedRealtime opens no channel of its own: it registers with the shared feed-live channel", () => {
    expect(feedHook.length, "useFeedRealtime not found before useNotificationRealtime").toBeGreaterThan(200);
    expect(feedHook).not.toMatch(/\.channel\(/);
    expect(feedHook).toMatch(/addFeedLiveConsumer\(/);
  });

  it("the shared module opens exactly one channel object, per user, and removes the previous one once the new one is subscribed", () => {
    expect(live.match(/supabase\.channel\(/g) ?? []).toHaveLength(1);
    expect(live).toMatch(/supabase\.channel\(`feed-live:\$\{f\.userId\}:/);
    expect(live).toMatch(/if \(status === "SUBSCRIBED"\) dropPrev\(\);/);
    expect(live).toMatch(/setTimeout\(dropPrev, PREV_GRACE_MS\)/);
  });

  it("the notification bell keeps its own guard — this change must not remove it", () => {
    expect(hook).toMatch(/useIsPrimaryInstance\(userId \? `notif-realtime:\$\{userId\}` : ""\)/);
  });
});
