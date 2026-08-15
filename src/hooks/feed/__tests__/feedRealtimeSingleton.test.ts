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
 * `useIsPrimaryInstance` exists for precisely this and was already applied to
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

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

const hook = code("src/hooks/feed/useRealtimeFeed.ts");

describe("the feed realtime channel is a singleton per client", () => {
  it("guards useFeedRealtime with useIsPrimaryInstance", () => {
    const feedHook = hook.slice(
      hook.indexOf("export function useFeedRealtime"),
      hook.indexOf("export function useNotificationRealtime"),
    );
    expect(feedHook.length, "useFeedRealtime not found before useNotificationRealtime")
      .toBeGreaterThan(200);
    expect(feedHook).toMatch(/useIsPrimaryInstance\(/);
    expect(feedHook).toMatch(/if \(!userId \|\| !isPrimary\) return;/);
  });

  it("keys the guard per user, so a re-login starts a new group", () => {
    expect(hook).toMatch(/useIsPrimaryInstance\(userId \? `feed-realtime:\$\{userId\}` : ""\)/);
  });

  it("re-subscribes when leadership moves, or a promoted instance stays silent", () => {
    const feedHook = hook.slice(
      hook.indexOf("export function useFeedRealtime"),
      hook.indexOf("export function useNotificationRealtime"),
    );
    expect(feedHook).toMatch(/\}, \[userId, isPrimary\]\)/);
  });

  it("still tears the channel down on unmount", () => {
    expect(hook).toMatch(/removeChannel\(channel\)/);
  });

  it("the notification bell keeps its own guard — this change must not remove it", () => {
    expect(hook).toMatch(/useIsPrimaryInstance\(userId \? `notif-realtime:\$\{userId\}` : ""\)/);
  });
});
