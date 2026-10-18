/**
 * S12-F5 · ★ Add to Favourites / Remove on a member's profile.
 *
 *   * the button reads the viewer's OWN row; tapping flips it at once and sends
 *     favouriteAuthor (outbox, natural key); tapping again sends
 *     unfavouriteAuthor;
 *   * a refusal (the 50 cap, FAVOURITES-001) flips it back and says why;
 *   * "Unmute" shows only when the viewer has muted that member;
 *   * never on the viewer's own profile;
 *   * the outbox: favourite / unfavourite target feed_favourite_authors by its
 *     natural key, and the sender helpers refuse a self-favourite.
 */
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const h = vi.hoisted(() => ({
  rows: { feed_favourite_authors: false, feed_muted_authors: false } as Record<string, boolean>,
  toast: vi.fn(),
  favouriteAuthor: vi.fn((): Promise<unknown> => Promise.resolve({ status: "delivered" })),
  unfavouriteAuthor: vi.fn((): Promise<unknown> => Promise.resolve({ status: "delivered" })),
  unmuteAuthor: vi.fn((): Promise<unknown> => Promise.resolve({ status: "delivered" })),
}));
vi.mock("@/hooks/core/use-toast", () => ({ toast: h.toast }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => ({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: h.rows[table] ? { author_id: "x" } : null, error: null }) }) }) }),
    }),
  },
}));
vi.mock("@/lib/feed/feedSignals", async (orig) => ({
  ...(await orig<typeof import("@/lib/feed/feedSignals")>()),
  favouriteAuthor: h.favouriteAuthor,
  unfavouriteAuthor: h.unfavouriteAuthor,
  unmuteAuthor: h.unmuteAuthor,
}));

const { default: FavouriteMuteButtons } = await import("@/components/profile/FavouriteMuteButtons");
const { OUTBOX_TARGETS } = await import("@/lib/offline/outbox");
const realSignals = await vi.importActual<typeof import("@/lib/feed/feedSignals")>("@/lib/feed/feedSignals");

const ME = "00000000-0000-4000-8000-0000000000aa";
const A = "20000000-0000-4000-8000-000000000001";

function mount(viewer = ME) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <FavouriteMuteButtons viewerId={viewer} authorId={A} authorName="Ana" />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  h.rows = { feed_favourite_authors: false, feed_muted_authors: false };
  vi.clearAllMocks();
});

describe("S12-F5 ★ favourite toggle", () => {
  it("not a favourite → tap adds (outbox), tap again removes", async () => {
    mount();
    const btn = await screen.findByTestId("profile-favourite-button");
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false));
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(btn);
    await waitFor(() => expect(btn.getAttribute("aria-pressed")).toBe("true"));
    expect(h.favouriteAuthor).toHaveBeenCalledWith(ME, A);
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Ana added to Favourites" })));
    fireEvent.click(btn);
    await waitFor(() => expect(btn.getAttribute("aria-pressed")).toBe("false"));
    expect(h.unfavouriteAuthor).toHaveBeenCalledWith(ME, A);
  });

  it("reads an existing favourite from the viewer's own row", async () => {
    h.rows.feed_favourite_authors = true;
    mount();
    await waitFor(() => expect(screen.getByTestId("profile-favourite-button").getAttribute("aria-pressed")).toBe("true"));
  });

  it("the 50-favourites cap flips it back and says why", async () => {
    h.favouriteAuthor.mockImplementationOnce(() => Promise.reject({ message: "FAVOURITES-001: at most 50 favourites" }));
    mount();
    const btn = await screen.findByTestId("profile-favourite-button");
    await waitFor(() => expect((btn as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(btn);
    await waitFor(() => expect(btn.getAttribute("aria-pressed")).toBe("false"));
    expect(h.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "You can have up to 50 favourites. Remove one first." }));
  });

  it("Unmute shows only for a muted member and sends unmuteAuthor", async () => {
    mount();
    await screen.findByTestId("profile-favourite-button");
    expect(screen.queryByTestId("profile-unmute-button")).toBeNull();
    h.rows.feed_muted_authors = true;
    mount();
    const un = await screen.findByTestId("profile-unmute-button");
    fireEvent.click(un);
    expect(h.unmuteAuthor).toHaveBeenCalledWith(ME, A);
    await waitFor(() => expect(screen.queryByTestId("profile-unmute-button")).toBeNull());
  });

  it("never on the viewer's own profile", () => {
    mount(A);
    expect(screen.queryByTestId("profile-favourite-button")).toBeNull();
  });

  it("outbox: favourite / unfavourite by feed_favourite_authors' natural key; no self-favourite", async () => {
    expect(OUTBOX_TARGETS.favourite).toEqual({ table: "feed_favourite_authors", kind: "natural", onConflict: "user_id,author_id" });
    expect(OUTBOX_TARGETS.unfavourite).toEqual({ table: "feed_favourite_authors", kind: "natural", onConflict: "user_id,author_id" });
    const submit = vi.fn(async () => ({ status: "queued" as const, key: "k" }));
    await realSignals.favouriteAuthor(ME, A, submit as never);
    await realSignals.unfavouriteAuthor(ME, A, submit as never);
    expect(submit.mock.calls).toEqual([[ME, { kind: "favourite", authorId: A }], [ME, { kind: "unfavourite", authorId: A }]]);
    expect(await realSignals.favouriteAuthor(ME, ME, submit as never)).toBeNull();
  });
});
