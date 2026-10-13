/**
 * Server conversion · the card at the bottom of the app (ServerVideoJobs):
 *   • only server jobs, one card each, in the member's words:
 *     "Uploading your video… 42%" / "You can close this page once it reaches 100%",
 *     "Your video is being prepared on our server" / "We'll show it here when it's ready",
 *     "Your video is ready" → Preview;
 *   • a failed conversion shows the database's own text, word for word;
 *   • Cancel asks first, then cancels through the job store (→ /source-cancel).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import type { JobEvent, VideoJob } from "@/lib/video/uploadJobs";

const OWNER = "11111111-1111-4111-8111-111111111111";
let jobs: VideoJob[] = [];
let listener: ((e: JobEvent) => void) | null = null;
const cancelServerJob = vi.fn(async (_id: string, _d: unknown) => true);
const dismissServerJob = vi.fn(async (_id: string) => {});
vi.mock("@/lib/video/uploadJobs", () => ({
  jobsFor: async () => jobs,
  subscribeVideoJobs: (fn: (e: JobEvent) => void) => { listener = fn; return () => { listener = null; }; },
  uploadProgress: () => undefined,
  cancelServerJob: (id: string, d: unknown) => cancelServerJob(id, d),
  dismissServerJob: (id: string) => dismissServerJob(id),
}));
const { deps } = vi.hoisted(() => ({ deps: { fake: true } }));
vi.mock("@/lib/video/jobDeps", () => ({ realJobDeps: deps }));
vi.mock("@/hooks/core/use-toast", () => ({ toast: vi.fn() }));
vi.mock("../ServerVideoReview", () => ({
  default: ({ job }: { job: VideoJob }) => <div data-testid="review-open">review {job.id}</div>,
}));

import ServerVideoJobs, { ServerJobsTray, failureText, jobView } from "../ServerVideoJobs";

const job = (over: Partial<VideoJob> = {}): VideoJob => ({
  id: "j1", userId: OWNER, purpose: "post", createdAt: 1, step: "converting", mode: "server",
  source: { id: "55555555-5555-4555-8555-555555555555", bytes: 10, name: "a.mov" }, uploaded: [],
  post: { content: "hi", categories: ["street"], privacy: "public", idempotencyKey: "k" }, attempts: 0, nextAt: 0, ...over,
});
const t = (_k: string, f: string) => f;
const noop = () => {};

beforeEach(() => { jobs = []; listener = null; cancelServerJob.mockClear(); dismissServerJob.mockClear(); });

describe("the card, in words", () => {
  it("uploading: the percentage, and when the page may be closed", () => {
    render(<ServerJobsTray jobs={[job({ step: "source" })]} progress={{ j1: 42 }} onPreview={noop} onCancel={noop} onDismiss={noop} />);
    expect(screen.getByText("Uploading your video… 42%")).toBeTruthy();
    expect(screen.getByText("You can close this page once it reaches 100%.")).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("42");
    expect(screen.getByRole("button", { name: "Cancel this video" })).toBeTruthy();
  });

  it("not going up this moment (offline, waiting for its turn, after a reload): waiting, not 0 %", () => {
    render(<ServerJobsTray jobs={[job({ step: "source" })]} progress={{}} onPreview={noop} onCancel={noop} onDismiss={noop} />);
    expect(screen.getByText("Your video is waiting to upload")).toBeTruthy();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("being prepared: on our server, and we'll show it here — the member may leave", () => {
    render(<ServerJobsTray jobs={[job()]} progress={{}} onPreview={noop} onCancel={noop} onDismiss={noop} />);
    expect(screen.getByText("Your video is being prepared on our server")).toBeTruthy();
    expect(screen.getByText("We'll show it here when it's ready. You can leave this page.")).toBeTruthy();
  });

  it("ready: Preview (the member watches it before it is posted)", () => {
    const onPreview = vi.fn();
    render(<ServerJobsTray jobs={[job({ step: "review", videoId: "v1" })]} progress={{}} onPreview={onPreview} onCancel={noop} onDismiss={noop} />);
    expect(screen.getByText("Your video is ready")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(onPreview).toHaveBeenCalledWith(expect.objectContaining({ id: "j1" }));
    expect(screen.queryByRole("button", { name: "Cancel this video" })).toBeNull();
  });

  it("an ad video says so", () => {
    expect(jobView(job({ purpose: "ad" }), undefined, t).title).toBe("Your ad video is being prepared on our server");
    expect(jobView(job({ purpose: "ad", step: "review" }), undefined, t).detail).toBe("Preview it, then add it to the ad.");
  });

  it("a failed conversion: the database's own text, word for word; Dismiss puts it away", () => {
    const text = "This file's format can't be converted. Try exporting it as MP4 and upload again.";
    const onDismiss = vi.fn();
    render(<ServerJobsTray jobs={[job({ step: "failed", errorCode: "VID-SRC-FAILED", lastError: text })]} progress={{}} onPreview={noop} onCancel={noop} onDismiss={onDismiss} />);
    expect(screen.getByText("Your video couldn't be prepared")).toBeTruthy();
    expect(screen.getByText(text)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalled();
  });

  it("other failures: plain words, never a code", () => {
    expect(failureText(job({ step: "failed", errorCode: "VID-SRC-001", lastError: "VID-SRC-001: server conversion is switched off on this site" }), t))
      .toBe("Server conversion was switched off before your video was sent. Please post it again.");
    expect(failureText(job({ step: "failed", errorCode: "VID-LIM-003", lastError: "VID-LIM-003: 10 video uploads in 24 hours is the limit" }), t))
      .toBe("10 video uploads in 24 hours is the limit");
    expect(failureText(job({ step: "failed", errorCode: "VID-RETRIES", lastError: "Failed to fetch" }), t))
      .toBe("The upload kept failing. Check your connection, then post it again.");
  });

  it("made, then refused at Post (or at the ad): 'couldn't be posted / added', as the device path says it", () => {
    const refused = { step: "failed" as const, errorCode: "VID-CAT-001", lastError: "VID-CAT-001: a video post needs between 1 and 5 categories", videoId: "v1" };
    expect(jobView(job(refused), undefined, t)).toMatchObject({ title: "Your video couldn't be posted", detail: "a video post needs between 1 and 5 categories" });
    expect(jobView(job({ ...refused, purpose: "ad" }), undefined, t).title).toBe("Your ad video couldn't be added");
    expect(jobView(job({ step: "failed", errorCode: "VID-SRC-FAILED", lastError: "This file has no video in it." }), undefined, t).title).toBe("Your video couldn't be prepared");
  });

  it("no server job → nothing at all", () => {
    const { container } = render(<ServerJobsTray jobs={[]} progress={{}} onPreview={noop} onCancel={noop} onDismiss={noop} />);
    expect(container.innerHTML).toBe("");
  });
});

describe("the card, live", () => {
  it("shows only server jobs, follows the upload's progress, and opens the preview", async () => {
    jobs = [job({ id: "dev", mode: undefined, step: "begun" }), job({ id: "j1", step: "source" }), job({ id: "j2", step: "review", videoId: "v" })];
    render(<ServerVideoJobs userId={OWNER} />);
    await waitFor(() => expect(screen.getAllByTestId("server-job")).toHaveLength(2));
    act(() => listener!({ type: "progress", job: jobs[1], sent: 420, total: 1000 }));
    expect(await screen.findByText("Uploading your video… 42%")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(await screen.findByTestId("review-open")).toHaveTextContent("review j2");
  });

  it("Cancel asks first; \"Keep it\" changes nothing; \"Cancel video\" cancels through the job store", async () => {
    jobs = [job({ id: "j1", step: "converting" })];
    render(<ServerVideoJobs userId={OWNER} />);
    fireEvent.click(await screen.findByRole("button", { name: "Cancel this video" }));
    expect(await screen.findByText("Cancel this video?")).toBeTruthy();
    expect(screen.getByText("Our server stops preparing it and nothing is posted.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Keep it" }));
    await waitFor(() => expect(screen.queryByText("Cancel this video?")).toBeNull());
    expect(cancelServerJob).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Cancel this video" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancel video" }));
    await waitFor(() => expect(cancelServerJob).toHaveBeenCalledWith("j1", deps));
  });
});
