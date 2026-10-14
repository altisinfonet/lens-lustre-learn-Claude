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
const dismissServerJob = vi.fn(async (_id: string, _d: unknown) => true);
vi.mock("@/lib/video/uploadJobs", () => ({
  jobsFor: async () => jobs,
  subscribeVideoJobs: (fn: (e: JobEvent) => void) => { listener = fn; return () => { listener = null; }; },
  uploadProgress: () => undefined,
  cancelServerJob: (id: string, d: unknown) => cancelServerJob(id, d),
  dismissServerJob: (id: string, d: unknown) => dismissServerJob(id, d),
}));
const { deps } = vi.hoisted(() => ({ deps: { fake: true } }));
vi.mock("@/lib/video/jobDeps", () => ({ realJobDeps: deps }));
vi.mock("@/hooks/core/use-toast", () => ({ toast: vi.fn() }));
vi.mock("../ServerVideoReview", () => ({
  default: ({ job }: { job: VideoJob }) => <div data-testid="review-open">review {job.id}</div>,
}));

import ServerVideoJobs, { ServerJobsTray, failureText, jobView, trayLine } from "../ServerVideoJobs";
import { toast } from "@/hooks/core/use-toast";

const job = (over: Partial<VideoJob> = {}): VideoJob => ({
  id: "j1", userId: OWNER, purpose: "post", createdAt: 1, step: "converting", mode: "server",
  source: { id: "55555555-5555-4555-8555-555555555555", bytes: 10, name: "a.mov" }, uploaded: [],
  post: { content: "hi", categories: ["street"], privacy: "public", idempotencyKey: "k" }, attempts: 0, nextAt: 0, ...over,
});
const t = (_k: string, f: string) => f;
const noop = () => {};

const phoneMatchMedia = window.matchMedia;
/** A computer: (min-width: 1024px) matches. jsdom's default (setup.ts) matches nothing — a phone. */
const asComputer = () => {
  window.matchMedia = ((q: string) => ({ ...phoneMatchMedia(q), matches: /min-width:\s*1024px/.test(q) })) as typeof window.matchMedia;
};
beforeEach(() => {
  jobs = []; listener = null; cancelServerJob.mockClear(); dismissServerJob.mockClear();
  window.matchMedia = phoneMatchMedia;
  document.documentElement.removeAttribute("style");
});

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
    fireEvent.click(await screen.findByRole("button", { name: /2 videos/ })); // two jobs on a phone: one slim line, tap to open
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

/*
 * ── Independent review of #423 (head a736ab19) and the Owner's compact rule ──
 * Each written to fail on the reviewed code first.
 */
describe("compact on a phone (Owner: one slim line when there is more than one job, or the cookie banner is up)", () => {
  const two = [job({ id: "a", step: "source" }), job({ id: "b", step: "review", videoId: "v" })];

  it("more than one job → ONE slim line naming the most urgent state; tap opens the list, 'Show less' folds it", () => {
    render(<ServerJobsTray jobs={two} progress={{ a: 42 }} onPreview={noop} onCancel={noop} onDismiss={noop} />);
    const line = screen.getByRole("button", { name: /2 videos · 1 ready to post/ });
    expect(line.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryAllByTestId("server-job")).toHaveLength(0);
    fireEvent.click(line);
    expect(screen.getAllByTestId("server-job")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: /Show less/ }));
    expect(screen.queryAllByTestId("server-job")).toHaveLength(0);
  });

  it("one job while the cookie banner is up → the slim line too", () => {
    document.documentElement.style.setProperty("--dock-consent", "433px");
    render(<ServerJobsTray jobs={[job({ step: "source" })]} progress={{ j1: 42 }} onPreview={noop} onCancel={noop} onDismiss={noop} />);
    expect(screen.getByRole("button", { name: /Uploading your video · 42%/ })).toBeTruthy();
    expect(screen.queryAllByTestId("server-job")).toHaveLength(0);
  });

  it("one job, no banner → the full card, as before", () => {
    render(<ServerJobsTray jobs={[job()]} progress={{}} onPreview={noop} onCancel={noop} onDismiss={noop} />);
    expect(screen.getAllByTestId("server-job")).toHaveLength(1);
  });

  it("on a computer the full list shows, whatever the count", () => {
    asComputer();
    render(<ServerJobsTray jobs={two} progress={{ a: 42 }} onPreview={noop} onCancel={noop} onDismiss={noop} />);
    expect(screen.getAllByTestId("server-job")).toHaveLength(2);
  });

  it("the open list scrolls inside a capped height — the stack never outgrows a short screen", () => {
    asComputer();
    render(<ServerJobsTray jobs={two} progress={{}} onPreview={noop} onCancel={noop} onDismiss={noop} />);
    const list = screen.getByTestId("server-job-list");
    expect(list.className).toMatch(/max-h-\[/);
    expect(list.className).toMatch(/overflow-y-auto/);
  });

  it("the slim line's words: count, then the most urgent state", () => {
    expect(trayLine([job({ step: "source" })], { j1: 7 }, t).text).toBe("Uploading your video · 7%");
    expect(trayLine([job()], {}, t).text).toBe("Preparing your video");
    expect(trayLine([job({ step: "review" })], {}, t).text).toBe("Your video is ready to post");
    expect(trayLine([job({ id: "a", step: "source" }), job({ id: "b" })], { a: 42 }, t).text).toBe("2 videos · uploading 42%");
    expect(trayLine([job({ id: "a" }), job({ id: "b", step: "failed", lastError: "x" }), job({ id: "c", step: "review" })], {}, t).text)
      .toBe("3 videos · 1 needs attention");
    expect(trayLine([job({ purpose: "ad" })], {}, t).text).toBe("Preparing your ad video");
  });
});

describe("accessibility (review #423, findings 7–9)", () => {
  it("the percentage is not announced on every step (aria-hidden); the progress bar carries it", () => {
    render(<ServerJobsTray jobs={[job({ step: "source" })]} progress={{ j1: 42 }} onPreview={noop} onCancel={noop} onDismiss={noop} />);
    const status = screen.getAllByRole("status")[0];
    const spoken = [...status.querySelectorAll("*")].filter((n) => n.closest("[aria-hidden='true']") === null && n.children.length === 0)
      .map((n) => n.textContent).join(" ");
    expect(spoken).toContain("Uploading your video…");
    expect(spoken).not.toContain("42");
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("42");
  });

  it("each close button is described by ITS OWN row's title", () => {
    asComputer();
    render(<ServerJobsTray jobs={[job({ id: "a" }), job({ id: "b", step: "failed", lastError: "x" })]} progress={{}} onPreview={noop} onCancel={noop} onDismiss={noop} />);
    const [cancel, dismiss] = [screen.getByRole("button", { name: "Cancel this video" }), screen.getByRole("button", { name: "Dismiss" })];
    const described = (b: HTMLElement) => document.getElementById(b.getAttribute("aria-describedby") ?? "")?.textContent;
    expect(described(cancel)).toBe("Your video is being prepared on our server");
    expect(described(dismiss)).toBe("Your video couldn't be prepared");
  });

  it("the card is drawn at the END of the document (a portal), so its buttons come after the page's in Tab order", () => {
    render(<div><button type="button">page</button><ServerJobsTray jobs={[job()]} progress={{}} onPreview={noop} onCancel={noop} onDismiss={noop} /></div>);
    const section = screen.getByTestId("server-video-jobs");
    expect(section.parentElement).toBe(document.body);
    expect(document.body.lastElementChild).toBe(section);
  });
});

describe("member-facing words for every refusal (review #423 nits)", () => {
  it("no raw state or Pages text: VID-STATE, VID-SRC-004 / -GONE and VID-AUTH each get a plain sentence", () => {
    expect(failureText(job({ step: "failed", errorCode: "VID-STATE", lastError: "the video is taken_down" }), t)).toBe("This video was taken down, so it can't be posted.");
    expect(failureText(job({ step: "failed", errorCode: "VID-STATE", lastError: "the video is failed" }), t)).toBe("Our checks couldn't finish this video. Please post it again.");
    expect(failureText(job({ step: "failed", errorCode: "VID-STATE", lastError: "the video is deleted" }), t)).toBe("This video was deleted before it was posted.");
    const gone = "This video was removed because it was not posted within 30 days. Please post it again.";
    expect(failureText(job({ step: "failed", errorCode: "VID-GONE", lastError: gone, videoId: "v" }), t)).toBe(gone);
    expect(failureText(job({ step: "failed", errorCode: "VID-SRC-004", lastError: "no such video of yours" }), t)).toBe(gone);
    expect(failureText(job({ step: "failed", errorCode: "VID-SRC-GONE", lastError: gone }), t)).toBe(gone);
    expect(failureText(job({ step: "failed", errorCode: "VID-AUTH-001", lastError: "sign in first" }), t)).toBe("Please sign in again, then post the video again.");
  });
});

/*
 * ── Added WITH the fixes (their own fail-first run is recorded beside the first:
 *    docs/evidence/d2/phase5/VID-1/server-mode-client/failfirst-added-a736ab19.txt).
 */
describe("review #423 · added with the fixes", () => {
  const two = [job({ id: "a", step: "source" }), job({ id: "b" })];

  it("the slim line is ONE full-width button, 44px tall, that says what it opens", () => {
    render(<ServerJobsTray jobs={two} progress={{ a: 42 }} onPreview={noop} onCancel={noop} onDismiss={noop} />);
    const line = screen.getByTestId("server-jobs-line");
    expect(line.tagName).toBe("BUTTON");
    expect(line.className).toMatch(/\bmin-h-11\b/);
    expect(line.className).toMatch(/\bw-full\b/);
    expect(screen.getAllByRole("button")).toHaveLength(1); // folded: nothing else to hit by mistake
    expect(line.getAttribute("aria-controls")).toBeNull(); // nothing to point at while the list is not drawn
    fireEvent.click(line);
    expect(line.getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById(line.getAttribute("aria-controls")!)).toBe(screen.getByTestId("server-job-list"));
  });

  it("folded, a change of state is said once — the count and the state, never the percentage", () => {
    render(<ServerJobsTray jobs={two} progress={{ a: 42 }} onPreview={noop} onCancel={noop} onDismiss={noop} />);
    expect(screen.getAllByRole("status").map((n) => n.textContent)).toEqual(["2 videos · uploading"]);
    expect(trayLine(two, { a: 42 }, t)).toMatchObject({ text: "2 videos · uploading 42%", spoken: "2 videos · uploading", pct: 42 });
  });

  it("the harness can draw the opened list (defaultOpen): the rows, and 'Show less' under them", () => {
    render(<ServerJobsTray jobs={two} progress={{ a: 42 }} defaultOpen onPreview={noop} onCancel={noop} onDismiss={noop} />);
    expect(screen.getAllByTestId("server-job")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Show less" }).getAttribute("aria-expanded")).toBe("true");
  });

  it("Dismiss takes the job off the server through the job store; if the server can't be told, the card stays and says so", async () => {
    jobs = [job({ id: "f", step: "failed", errorCode: "VID-LOCAL-001", lastError: "The video file is no longer on this device. Please post it again." })];
    dismissServerJob.mockResolvedValueOnce(false);
    render(<ServerVideoJobs userId={OWNER} />);
    fireEvent.click(await screen.findByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(dismissServerJob).toHaveBeenCalledWith("f", deps));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Couldn't remove it just now" })));
    expect(screen.getAllByTestId("server-job")).toHaveLength(1);
  });

  it("another member on the same device never sees the last member's job — not for one frame", async () => {
    jobs = [job({ id: "a1", step: "review", videoId: "v" })];
    const { rerender } = render(<ServerVideoJobs userId={OWNER} />);
    expect(await screen.findByText("Your video is ready")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(await screen.findByTestId("review-open")).toBeTruthy();
    rerender(<ServerVideoJobs userId="22222222-2222-4222-8222-222222222222" />);
    // At once — before the new member's list has been read — and after it has.
    expect(screen.queryByTestId("server-video-jobs")).toBeNull();
    expect(screen.queryByTestId("review-open")).toBeNull();
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(screen.queryByTestId("server-video-jobs")).toBeNull();
  });

  it("a request our own app got wrong is never shown raw", () => {
    const plain = "Something went wrong sending this video. Please post it again.";
    expect(failureText(job({ step: "failed", errorCode: "VID-REQ-001", lastError: "source_id must be a lowercase uuid" }), t)).toBe(plain);
    expect(failureText(job({ step: "failed", errorCode: "VID-SRC-009", lastError: "the declared size is not valid" }), t)).toBe(plain);
  });

  it("Preview, too, is described by its own row's title", () => {
    asComputer();
    render(<ServerJobsTray jobs={[job({ id: "a", step: "review", videoId: "v" }), job({ id: "b" })]} progress={{}} onPreview={noop} onCancel={noop} onDismiss={noop} />);
    const preview = screen.getByRole("button", { name: "Preview" });
    expect(document.getElementById(preview.getAttribute("aria-describedby") ?? "")?.textContent).toBe("Your video is ready");
  });
});
