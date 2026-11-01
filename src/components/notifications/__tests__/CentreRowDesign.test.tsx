/**
 * N7b · the approved Instagram-style row (notif_centre_ui on), one component
 * for the bell and /notifications, web and app:
 *   - round avatar, two stacked avatars for a grouped row, a small type badge;
 *   - no grey X on every row: a ⋯ menu (Remove · Turn off this kind) and,
 *     on touch, swipe left to remove;
 *   - Follow back stays on follow rows.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import type { NotificationGroup } from "@/lib/notificationText";

vi.mock("@/i18n/I18nContext", () => ({ useT: () => (_k: string, fb?: string) => fb ?? _k }));
vi.mock("@/components/video/VideoPoster", () => ({ default: () => <span /> }));

import CentreNotificationRow from "@/components/notifications/CentreNotificationRow";

const g = (over: Partial<NotificationGroup> = {}): NotificationGroup => ({
  group_key: "k", type: "post_reaction", notification_ids: ["n1"], actor_ids: ["a1"], actor_names: ["Anindita Hidayat"],
  actor_usernames: ["anindita"], actor_avatars: ["https://example.test/a.jpg"], actor_count: 1, event_count: 1,
  unread_count: 1, reference_id: "post-1", thumbnail_url: "https://example.test/p.jpg", title: "t", message: "m",
  latest_at: new Date().toISOString(), ...over,
});

const onDelete = vi.fn();
const onTurnOff = vi.fn();
const row = (group: NotificationGroup, extra: Record<string, unknown> = {}) =>
  render(
    <CentreNotificationRow
      group={group} video={null} isFollowing={false} followReady followPending={false} adminIds={new Set()}
      onOpen={vi.fn()} onFollowBack={vi.fn()} onDelete={onDelete} onTurnOff={onTurnOff} {...extra}
    />,
  );

beforeEach(() => { cleanup(); vi.clearAllMocks(); });

describe("N7b row design", () => {
  it("a like row carries a like badge; a follow row a follow badge; a finalist row a competition badge", () => {
    const a = row(g());
    expect(a.container.querySelector("[data-notif-badge]")?.getAttribute("data-notif-badge")).toBe("like");
    cleanup();
    const b = row(g({ type: "new_follower", thumbnail_url: null }));
    expect(b.container.querySelector("[data-notif-badge]")?.getAttribute("data-notif-badge")).toBe("follow");
    cleanup();
    const c = row(g({ type: "entry_finalist", actor_ids: [], actor_names: [], actor_avatars: [], actor_count: 0 }));
    expect(c.container.querySelector("[data-notif-badge]")?.getAttribute("data-notif-badge")).toBe("competition");
  });

  it("a grouped row shows two stacked avatars; a single row one", () => {
    const a = row(g({ actor_ids: ["a1", "a2"], actor_names: ["A One", "B Two"], actor_avatars: ["https://example.test/1.jpg", ""], actor_count: 2 }));
    expect(a.container.querySelectorAll("[data-notif-avatar]").length).toBe(2);
    cleanup();
    const b = row(g());
    expect(b.container.querySelectorAll("[data-notif-avatar]").length).toBe(1);
  });

  it("no Delete X on the row; a ⋯ menu holds Remove and Turn off this kind", () => {
    row(g());
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();
    const more = screen.getByRole("button", { name: "More options" });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(more);
    expect(more.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Turn off this kind" }));
    expect(onTurnOff).toHaveBeenCalledWith("inapp_reactions");
    fireEvent.click(more);
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("Turn off is not offered for a kind a member cannot turn off", () => {
    row(g({ type: "not_a_type" }));
    fireEvent.click(screen.getByRole("button", { name: "More options" }));
    expect(screen.getByRole("button", { name: "Remove" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Turn off this kind" })).toBeNull();
  });

  it("swiping a row left on touch removes it; a vertical scroll does not", () => {
    const { container } = row(g());
    const el = container.querySelector("[data-notif-row]")!;
    fireEvent.touchStart(el, { touches: [{ clientX: 300, clientY: 100 }] });
    fireEvent.touchMove(el, { touches: [{ clientX: 290, clientY: 180 }] });
    fireEvent.touchEnd(el, { changedTouches: [{ clientX: 290, clientY: 180 }] });
    expect(onDelete).not.toHaveBeenCalled();
    fireEvent.touchStart(el, { touches: [{ clientX: 300, clientY: 100 }] });
    fireEvent.touchMove(el, { touches: [{ clientX: 150, clientY: 104 }] });
    fireEvent.touchEnd(el, { changedTouches: [{ clientX: 150, clientY: 104 }] });
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it("Follow back stays on a follow row", () => {
    row(g({ type: "new_follower", thumbnail_url: null }));
    expect(screen.getByRole("button", { name: "Follow back" })).toBeTruthy();
  });
});
