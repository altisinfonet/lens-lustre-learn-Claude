/**
 * S12-F5 · ⋯ → "Not interested" and "Mute <name>", each with Undo.
 *
 *   * Not interested: the card is hidden at once, hidePost goes to the outbox;
 *     Undo brings the card back and sends unhidePost;
 *   * Mute: every post by that author is hidden, muteAuthor is sent; Undo sends
 *     unmuteAuthor;
 *   * the outbox: hide → unhide of one post collapses to the last intent while
 *     unsent; unhide_post deletes by the natural key.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactElement } from "react";

const h = vi.hoisted(() => ({
  toast: vi.fn(),
  hidePost: vi.fn(() => Promise.resolve(null)),
  unhidePost: vi.fn(() => Promise.resolve(null)),
  muteAuthor: vi.fn(() => Promise.resolve(null)),
  unmuteAuthor: vi.fn(() => Promise.resolve(null)),
}));
vi.mock("@/hooks/core/use-toast", () => ({ toast: h.toast }));
vi.mock("@/lib/feed/feedSignals", async (orig) => ({
  ...(await orig<typeof import("@/lib/feed/feedSignals")>()),
  hidePost: h.hidePost,
  unhidePost: h.unhidePost,
  muteAuthor: h.muteAuthor,
  unmuteAuthor: h.unmuteAuthor,
}));

const { useHideAndMute, __resetHideAndMute } = await import("@/hooks/feed/useHideAndMute");
const { OUTBOX_TARGETS } = await import("@/lib/offline/outbox");

const ME = "00000000-0000-4000-8000-0000000000aa";
const A = "20000000-0000-4000-8000-000000000001";
const P1 = { id: "10000000-0000-4000-8000-000000000001", user_id: A, author_name: "Ana" };
const P2 = { id: "10000000-0000-4000-8000-000000000002", user_id: A, author_name: "Ana" };

/** The Undo button the last toast carried. */
const lastUndo = () => (h.toast.mock.calls.at(-1)![0] as { action: ReactElement<{ onClick: () => void }> }).action.props.onClick;

beforeEach(() => {
  __resetHideAndMute();
  vi.clearAllMocks();
});

describe("S12-F5 Not interested + Undo", () => {
  it("hides the card at once, records it once, and Undo brings it back", () => {
    const { result } = renderHook(() => useHideAndMute(ME));
    expect(result.current.isHidden(P1)).toBe(false);
    act(() => result.current.notInterested(P1));
    expect(result.current.isHidden(P1)).toBe(true);
    expect(result.current.isHidden(P2)).toBe(false);
    expect(h.hidePost).toHaveBeenCalledTimes(1);
    expect(h.hidePost).toHaveBeenCalledWith(ME, P1.id, "not_interested");
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Post hidden" }));
    act(() => lastUndo()());
    expect(result.current.isHidden(P1)).toBe(false);
    expect(h.unhidePost).toHaveBeenCalledWith(ME, P1.id);
  });

  it("a hidden card stays hidden after the feed remounts (Back)", () => {
    const first = renderHook(() => useHideAndMute(ME));
    act(() => first.result.current.notInterested(P1));
    first.unmount();
    const again = renderHook(() => useHideAndMute(ME));
    expect(again.result.current.isHidden(P1)).toBe(true);
  });

  it("Mute hides every post by the author; Undo unmutes", () => {
    const { result } = renderHook(() => useHideAndMute(ME));
    act(() => result.current.mute(P1));
    expect(result.current.isHidden(P1)).toBe(true);
    expect(result.current.isHidden(P2)).toBe(true);
    expect(h.muteAuthor).toHaveBeenCalledWith(ME, A);
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Muted Ana" }));
    act(() => lastUndo()());
    expect(result.current.isHidden(P2)).toBe(false);
    expect(h.unmuteAuthor).toHaveBeenCalledWith(ME, A);
  });

  it("never hides or mutes the member's own post", () => {
    const { result } = renderHook(() => useHideAndMute(A));
    act(() => { result.current.notInterested(P1); result.current.mute(P1); });
    expect(result.current.isHidden(P1)).toBe(false);
    expect(h.hidePost).not.toHaveBeenCalled();
    expect(h.muteAuthor).not.toHaveBeenCalled();
  });

  it("unhide_post is in D1's contract with feed_hidden_posts' natural key", () => {
    expect(OUTBOX_TARGETS.unhide_post).toEqual({ table: "feed_hidden_posts", kind: "natural", onConflict: "user_id,post_id" });
  });
});
