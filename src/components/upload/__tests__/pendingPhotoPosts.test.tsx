/**
 * S7b-5b · a post with photos made with no network is SHOWN at once, marked
 * "Will post when online", until the job publishes it (exactly once — the job
 * id is its idempotency key, S5).
 */
import React from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";

vi.mock("@/lib/upload/photoJobs", async (orig) => {
  const real = await orig<typeof import("@/lib/upload/photoJobs")>();
  return real;
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

  it("shows nothing for published, failed or another member's jobs", async () => {
    const store = memoryUploadStore<import("@/lib/upload/photoJobs").PhotoJob>();
    jobs.__setPhotoStore(store);
    const base = { createdAt: 1, slots: [], attempts: 0, nextAt: 0, post: { content: "x", privacy: "public", categories: [], indexingDisabled: false } };
    await store.putJob({ ...base, id: "a", userId: "me-1", step: "published" });
    await store.putJob({ ...base, id: "b", userId: "me-1", step: "failed" });
    await store.putJob({ ...base, id: "c", userId: "someone-else", step: "encoded" });
    await act(async () => { render(<PendingPhotoPosts />); await new Promise((r) => setTimeout(r, 20)); });
    expect(screen.queryByText(/Will post when online/)).toBeNull();
  });
});
