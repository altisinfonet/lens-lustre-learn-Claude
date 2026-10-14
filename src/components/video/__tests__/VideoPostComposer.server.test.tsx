/**
 * Server conversion · the upload screen when the site says "server"
 * (site_settings video_conversion, read through the shared cache):
 *   • nothing is encoded here — Post starts the server job with what the
 *     member wrote and chose, and the screen closes (the corner card takes over);
 *   • only the 500 MB rule applies; a format this browser can't play may still
 *     go (the converter judges it), and the device path still refuses it;
 *   • the cover and "Remove sound" are device-only and not offered;
 *   • VID-SRC-001 (switched off meanwhile) turns the screen back into the
 *     device path, says so, and Post then encodes here.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

let setting: unknown = "server";
vi.mock("@/lib/siteSettingsCache", () => ({ getSiteSetting: async () => setting, invalidateSiteSetting: () => {} }));
const facts = { durationSeconds: 30, bytes: 10_000_000, width: 1080, height: 1920 };
vi.mock("@/lib/video/limits", async (orig) => {
  const real = await orig<typeof import("@/lib/video/limits")>();
  return { ...real, readVideoFacts: vi.fn(async () => ({ ...facts })) };
});
vi.mock("@/components/post/CategoryChips", () => ({
  default: ({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) => (
    <button type="button" onClick={() => onChange([...value, `c${value.length}`])}>add category ({value.length})</button>
  ),
  canPublishCategories: (v: string[]) => v.length >= 1 && v.length <= 5,
}));
const USER = "11111111-1111-4111-8111-111111111111";
vi.mock("@/hooks/core/useAuth", () => ({ useAuth: () => ({ user: { id: USER } }) }));
vi.mock("@/lib/video/cover", () => ({ coverFromImage: vi.fn(async () => new Uint8Array([1])), coverFromVideoAt: vi.fn(async () => new Uint8Array([2])) }));
const createJob = vi.fn(async (_i: unknown) => ({}));
vi.mock("@/lib/video/uploadJobs", () => ({ createJob: (i: unknown) => createJob(i), runVideoJobs: vi.fn(async () => {}) }));
const { deps } = vi.hoisted(() => ({ deps: { fake: true } }));
vi.mock("@/lib/video/jobDeps", () => ({ realJobDeps: deps }));
type Start = { kind: "started"; jobId: string } | { kind: "switched_off" } | { kind: "refused"; message: string };
let answer: Start = { kind: "started", jobId: "j1" };
const startOnServer = vi.fn(async (_input: unknown, _d: unknown): Promise<Start> => answer);
vi.mock("@/lib/video/startOnServer", () => ({ startOnServer: (i: unknown, d: unknown) => startOnServer(i, d) }));

import VideoPostComposer from "../VideoPostComposer";
import { readVideoFacts } from "@/lib/video/limits";

beforeEach(() => {
  setting = "server"; answer = { kind: "started", jobId: "j1" }; startOnServer.mockClear(); createJob.mockClear();
  (globalThis.URL as unknown as { createObjectURL: () => string }).createObjectURL = () => "blob:x";
  (globalThis.URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {};
});

const file = new File([new Uint8Array(1_200_000)], "clip.mov", { type: "video/quicktime" });
const inServerMode = async () => waitFor(() => expect(screen.getByTestId("video-composer").getAttribute("data-conversion")).toBe("server"));
const postButton = () => screen.getByRole("button", { name: "Post video" }) as HTMLButtonElement;

describe("VideoPostComposer · server conversion", () => {
  it("no cover, no Remove sound; says the page may be closed at 100%; Post starts the server job and closes", async () => {
    const onOpenChange = vi.fn();
    render(<VideoPostComposer open onOpenChange={onOpenChange} initialFile={file} />);
    await inServerMode();
    await waitFor(() => expect(screen.getByText(/0:30/)).toBeTruthy());
    expect(screen.getByTestId("video-server-note").textContent).toMatch(/once the upload reaches 100% you can close this page/);
    expect(screen.queryByTestId("video-cover")).toBeNull();
    expect(screen.queryByText("Remove sound")).toBeNull();
    fireEvent.change(screen.getByRole("textbox", { name: /Say something/ }), { target: { value: "  Sunset  " } });
    fireEvent.click(screen.getByRole("button", { name: /add category/ }));
    await waitFor(() => expect(postButton().disabled).toBe(false));
    fireEvent.click(postButton());
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(startOnServer).toHaveBeenCalledWith(
      { userId: USER, purpose: "post", file, name: "clip.mov", post: { content: "Sunset", categories: ["c0"], privacy: "public" } }, deps,
    );
    expect(createJob).not.toHaveBeenCalled(); // nothing encoded, no device job
  });

  it("a long video carries no 'this device prepares it' note — our server does", async () => {
    vi.mocked(readVideoFacts).mockResolvedValueOnce({ ...facts, durationSeconds: 448 });
    render(<VideoPostComposer open onOpenChange={() => {}} initialFile={file} />);
    await inServerMode();
    await waitFor(() => expect(screen.getByText(/7:28/)).toBeTruthy());
    expect(screen.queryByTestId("video-long-note")).toBeNull();
    expect(screen.getByTestId("video-server-note")).toBeTruthy();
  });

  it("a format this browser can't play may still be posted — the converter judges it", async () => {
    vi.mocked(readVideoFacts).mockRejectedValueOnce(new Error("VID-META-003: This browser can't play this video's format"));
    render(<VideoPostComposer open onOpenChange={() => {}} initialFile={file} />);
    await inServerMode();
    const tile = await screen.findByTestId("video-no-preview");
    expect(tile).toHaveTextContent("clip.mov");
    expect(tile).toHaveTextContent(/1 MB · this browser can't show a preview/);
    expect(screen.queryByTestId("video-preview-frame")).toBeNull(); // no empty 9:16 frame
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /add category/ }));
    await waitFor(() => expect(postButton().disabled).toBe(false));
    fireEvent.click(postButton());
    await waitFor(() => expect(startOnServer).toHaveBeenCalled());
  });

  it("…and on the device it is refused, exactly as before", async () => {
    setting = "device";
    vi.mocked(readVideoFacts).mockRejectedValueOnce(new Error("VID-META-003: This browser can't play this video's format"));
    render(<VideoPostComposer open onOpenChange={() => {}} initialFile={file} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("This browser can't play this video's format");
    fireEvent.click(screen.getByRole("button", { name: /add category/ }));
    expect(postButton().disabled).toBe(true);
    expect(screen.getByTestId("video-composer").getAttribute("data-conversion")).toBe("device");
  });

  it("over 500 MB is refused before anything is sent", async () => {
    const big = new File([new Uint8Array(10)], "big.mov");
    Object.defineProperty(big, "size", { value: 600 * 1_048_576 });
    render(<VideoPostComposer open onOpenChange={() => {}} initialFile={big} />);
    await inServerMode();
    expect(await screen.findByText(/Videos can be up to 500 MB/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /add category/ }));
    expect(postButton().disabled).toBe(true);
  });

  it("VID-SRC-001: the screen says server conversion was switched off and becomes the device path; Post encodes here", async () => {
    answer = { kind: "switched_off" };
    const encode = vi.fn(async () => ({ files: new Map(), manifest: {} as never, manifestSha256: "m" }));
    render(<VideoPostComposer open onOpenChange={() => {}} initialFile={file} encode={encode} />);
    await inServerMode();
    await waitFor(() => expect(screen.getByText(/0:30/)).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /add category/ }));
    await waitFor(() => expect(postButton().disabled).toBe(false));
    fireEvent.click(postButton());
    expect(await screen.findByTestId("video-server-off")).toHaveTextContent("Server conversion was just switched off");
    expect(screen.getByTestId("video-composer").getAttribute("data-conversion")).toBe("device");
    expect(screen.getByTestId("video-cover")).toBeTruthy();
    expect(screen.getByText("Remove sound")).toBeTruthy();
    await waitFor(() => expect(postButton().disabled).toBe(false));
    fireEvent.click(postButton());
    await waitFor(() => expect(encode).toHaveBeenCalled());
    await waitFor(() => expect(createJob).toHaveBeenCalled());
    expect(startOnServer).toHaveBeenCalledTimes(1);
  });

  it("any other refusal is said on this screen", async () => {
    answer = { kind: "refused", message: "10 video uploads in 24 hours is the limit" };
    render(<VideoPostComposer open onOpenChange={() => {}} initialFile={file} />);
    await inServerMode();
    await waitFor(() => expect(screen.getByText(/0:30/)).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /add category/ }));
    await waitFor(() => expect(postButton().disabled).toBe(false));
    fireEvent.click(postButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("10 video uploads in 24 hours is the limit");
  });
});
