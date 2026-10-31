/**
 * Server conversion · the member watches the READY video, then posts it
 * (CONVERTER-DESIGN.md v2 §3.9):
 *   • the member's own video is read (RLS) and played in the feed's card;
 *   • Post publishes through the job store (video_publish_post with what was
 *     chosen) — never before the video could be read;
 *   • Discard asks once more, then cancels the job (the made video is deleted).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { VideoJob } from "@/lib/video/uploadJobs";

const approveServerJob = vi.fn(async (_id: string, _d: unknown) => {});
const cancelServerJob = vi.fn(async (_id: string, _d: unknown) => true);
vi.mock("@/lib/video/uploadJobs", () => ({
  approveServerJob: (id: string, d: unknown) => approveServerJob(id, d),
  cancelServerJob: (id: string, d: unknown) => cancelServerJob(id, d),
}));
const { deps } = vi.hoisted(() => ({ deps: { fake: true } }));
vi.mock("@/lib/video/jobDeps", () => ({ realJobDeps: deps }));
const VIDEO = { id: "v1", width: 1080, height: 1920, durationS: 30, hasAudio: true };
let readResult: unknown = VIDEO;
const fetchOwnVideo = vi.fn(async (_id: string) => readResult);
vi.mock("@/lib/video/postVideoRead", () => ({ fetchOwnVideo: (id: string) => fetchOwnVideo(id) }));
vi.mock("../FeedVideoCard", () => ({ default: ({ video }: { video: { id: string } }) => <div data-testid="player">playing {video.id}</div> }));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ data: [{ slug: "street", name: "Street" }, { slug: "travel", name: "Travel" }] }),
}));

import ServerVideoReview from "../ServerVideoReview";

const job = (over: Partial<VideoJob> = {}): VideoJob => ({
  id: "j1", userId: "u", purpose: "post", createdAt: 1, step: "review", mode: "server", videoId: "v1",
  source: { id: "s", bytes: 10, name: "a.mov" }, uploaded: [],
  post: { content: "Sunset over the Hooghly", categories: ["street", "travel"], privacy: "friends", idempotencyKey: "k" }, attempts: 0, nextAt: 0, ...over,
});

beforeEach(() => { approveServerJob.mockClear(); cancelServerJob.mockClear(); fetchOwnVideo.mockClear(); readResult = VIDEO; });

describe("ServerVideoReview", () => {
  it("plays the member's own video in the feed card, with what they wrote and chose", async () => {
    render(<ServerVideoReview job={job()} onClose={() => {}} />);
    expect(await screen.findByTestId("player")).toHaveTextContent("playing v1");
    expect(fetchOwnVideo).toHaveBeenCalledWith("v1");
    expect(screen.getByText("Your video is ready")).toBeTruthy();
    expect(screen.getByText("Sunset over the Hooghly")).toBeTruthy();
    expect(screen.getByText("Friends")).toBeTruthy();
    expect(screen.getByText("Street, Travel")).toBeTruthy(); // named as the category chips name them, never the slug
  });

  it("Post → published through the job store; the dialog closes at once", async () => {
    const onClose = vi.fn();
    render(<ServerVideoReview job={job()} onClose={onClose} />);
    const postBtn = await screen.findByRole("button", { name: "Post video" });
    await waitFor(() => expect((postBtn as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(postBtn);
    expect(onClose).toHaveBeenCalled();
    await waitFor(() => expect(approveServerJob).toHaveBeenCalledWith("j1", deps));
  });

  it("a video that can't be read (no longer ready) can't be posted from here", async () => {
    readResult = null;
    render(<ServerVideoReview job={job()} onClose={() => {}} />);
    expect(await screen.findByText("This video can't be played right now. Try again in a moment.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Post video" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("Discard asks once more, then cancels the job", async () => {
    const onClose = vi.fn();
    render(<ServerVideoReview job={job()} onClose={onClose} />);
    await screen.findByTestId("player");
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(cancelServerJob).not.toHaveBeenCalled();
    expect(screen.getByText("Tap Discard again to delete this video. It won't be posted.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(cancelServerJob).toHaveBeenCalledWith("j1", deps));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("an ad video: Add to the ad, no caption or audience", async () => {
    render(<ServerVideoReview job={job({ purpose: "ad", post: { content: "", categories: ["travel"], privacy: "public", idempotencyKey: "k" }, ad: { creativeId: "c" } })} onClose={() => {}} />);
    expect(await screen.findByText("Your ad video is ready")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add to the ad" })).toBeTruthy();
    expect(screen.queryByText("Public")).toBeNull();
  });
});
