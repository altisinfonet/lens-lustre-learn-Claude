/**
 * THE APP'S SINGLE UPLOADER, mounted in the shell rather than on a page.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Owner, 2026-08-16: "create post is a static on the top menu bar but while on
 * my or other pages, trying to uploaded - that is not happening. only from my
 * feed section create post happening... as top menu icon is fix it should be
 * from single uploader while standing on any page - that is not happening."
 *
 * A fixed button that behaves differently depending on the page beneath it is
 * the bug. It existed because the composer lived inside the Feed page, so the
 * button had to navigate there first — and that navigation raced Android's
 * photo picker, which backgrounds the WebView as it opens.
 *
 * Living here, the composer is part of the shell: always mounted, opened by the
 * `?compose=1` flag on whatever url the member is already on. Nothing navigates.
 *
 * WHY A WRAPPER RATHER THAN `<WallPosts …>` INLINE IN Layout: this file is the
 * one place that states what the shell mounts and why. `WallPosts` is a
 * 2,000-line component with a list, a grid, drafts and a composer; mounting it
 * bare in the layout with two props would leave the next reader guessing which
 * of those the shell wanted. `composerOnly` is the whole answer and it deserves
 * to be written down next to the mount.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import WallPosts from "@/components/WallPosts";

export default function GlobalComposer({ userId }: { userId: string }) {
  /**
   * `isOwnWall` is true because a member composing from the shell is always
   * posting AS THEMSELVES to their own wall — there is no other wall the top-bar
   * button could mean.
   */
  return (
    <div data-testid="global-composer">
      <WallPosts targetUserId={userId} isOwnWall composerOnly />
    </div>
  );
}
