/**
 * S7b-5b · a post with photos made with no network is SHOWN at once, marked
 * "Will post when online", until the job publishes it (exactly once — the job
 * id is its idempotency key, S5).
 */
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";

// The real job store, with the two calls the card makes wrapped so a test can
// hold a read back or fire a job event by hand.
vi.mock("@/lib/upload/photoJobs", async (orig) => {
  const real = await orig<typeof import("@/lib/upload/photoJobs")>();
  return { ...real, photoJobsFor: vi.fn(real.photoJobsFor), subscribePhotoJobs: vi.fn(real.subscribePhotoJobs) };
});
vi.mock("@/hooks/core/useAuth", () => ({ useAuth: () => ({ user: { id: "me-1" }, loading: false }) }));

const jobs = await import("@/lib/upload/photoJobs");
const { memoryUploadStore } = await import("@/lib/upload/jobStore");
const { default: PendingPhotoPosts } = await import("@/components/upload/PendingPhotoPosts");

beforeEach(() => {
  jobs.__resetPhotoJobs();
  jobs.__setPhotoStore(memoryUploadStore());
});

describe("pending photo posts", () => {
  it("shows a queued post with its caption and 'Will post when online'", async () => {
    const store = memoryUploadStore<import("@/lib/upload/photoJobs").PhotoJob>();
    jobs.__setPhotoStore(store);
    await store.putJob({
      id: "j1", userId: "me-1", createdAt: 1, step: "encoded", slots: [{} as never, {} as never], attempts: 0, nextAt: 0,
      post: { content: "Fog on the river", privacy: "public", categories: [], indexingDisabled: false },
    });
    render(<PendingPhotoPosts />);
    expect(await screen.findByText(/Fog on the river/)).toBeTruthy();
    expect(screen.getByText(/Will post when online/)).toBeTruthy();
    expect(screen.getByText(/2 photos/)).toBeTruthy();
  });

  it("shows only the member's own unpublished jobs (not published, failed or another member's)", async () => {
    const store = memoryUploadStore<import("@/lib/upload/photoJobs").PhotoJob>();
    jobs.__setPhotoStore(store);
    const base = { createdAt: 1, slots: [], attempts: 0, nextAt: 0, post: { content: "x", privacy: "public", categories: [], indexingDisabled: false } };
    await store.putJob({ ...base, id: "a", userId: "me-1", step: "published" });
    await store.putJob({ ...base, id: "b", userId: "me-1", step: "failed" });
    await store.putJob({ ...base, id: "c", userId: "someone-else", step: "encoded" });
    await store.putJob({ ...base, id: "d", userId: "me-1", step: "encoded", post: { ...base.post, content: "mine, still waiting" } });
    await act(async () => { render(<PendingPhotoPosts />); await new Promise((r) => setTimeout(r, 20)); });
    // positive control in the same render: the card does render
    expect(screen.getByText(/mine, still waiting/)).toBeTruthy();
    expect(screen.getAllByText(/Will post when online/)).toHaveLength(1);
  });

  it("review #583: an older read that finishes last never brings back a published post", async () => {
    const pending = {
      id: "j1", userId: "me-1", createdAt: 1, step: "encoded" as const, slots: [{} as never], attempts: 0, nextAt: 0,
      post: { content: "Fog on the river", privacy: "public", categories: [], indexingDisabled: false },
    };
    let fire: (e: import("@/lib/upload/photoJobs").PhotoJobEvent) => void = () => {};
    vi.mocked(jobs.subscribePhotoJobs).mockImplementationOnce((fn) => { fire = fn; return () => {}; });
    let finishOld: (v: import("@/lib/upload/photoJobs").PhotoJob[]) => void = () => {};
    vi.mocked(jobs.photoJobsFor)
      .mockImplementationOnce(() => new Promise((r) => { finishOld = r; })) // first read: slow, sees it pending
      .mockImplementationOnce(async () => [{ ...pending, step: "published" }]); // after "published": done
    await act(async () => { render(<PendingPhotoPosts />); });
    await act(async () => { fire({ type: "published", id: "j1" } as never); await Promise.resolve(); });
    await act(async () => { finishOld([pending]); await new Promise((r) => setTimeout(r, 10)); });
    expect(screen.queryByText(/Will post when online/)).toBeNull();
  });
});
