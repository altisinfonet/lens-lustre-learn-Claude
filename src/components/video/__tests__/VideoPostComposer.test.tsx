/**
 * R-104 · the upload screen's rules, as the member meets them:
 *   • every video previews in the 9:16 card (Owner 2026-10-05): a 9:16 video
 *     fills it; a 16:9 one is fitted whole with a blurred fill above and below;
 *   • over 3 minutes or over 500 MB → said before encoding, Post stays off;
 *   • Post stays off until 1–5 categories are chosen.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

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
vi.mock("@/hooks/core/useAuth", () => ({ useAuth: () => ({ user: { id: "11111111-1111-4111-8111-111111111111" } }) }));

import VideoPostComposer from "../VideoPostComposer";
import { readVideoFacts } from "@/lib/video/limits";

beforeEach(() => {
  (globalThis.URL as unknown as { createObjectURL: () => string }).createObjectURL = () => "blob:x";
  (globalThis.URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {};
});

const file = new File([new Uint8Array(10)], "v.mp4", { type: "video/mp4" });

describe("VideoPostComposer", () => {
  it("a 9:16 video fills the 9:16 card edge to edge, no fill layer", async () => {
    render(<VideoPostComposer open onOpenChange={() => {}} initialFile={file} />);
    const frame = await screen.findByTestId("video-preview-frame");
    await waitFor(() => expect(screen.getByText(/0:30/)).toBeTruthy());
    expect(frame.getAttribute("data-frame-aspect")).toBe("0.563");
    expect(frame.querySelectorAll("video").length).toBe(1);
  });

  it("a 16:9 video is fitted WHOLE into the same 9:16 card, with the blurred fill (never cropped)", async () => {
    vi.mocked(readVideoFacts).mockResolvedValueOnce({ ...facts, width: 1920, height: 1080 });
    render(<VideoPostComposer open onOpenChange={() => {}} initialFile={file} />);
    const frame = await screen.findByTestId("video-preview-frame");
    await waitFor(() => expect(frame.querySelectorAll("video").length).toBe(2)); // the blurred fill + the video
    expect(frame.getAttribute("data-frame-aspect")).toBe("0.563");
    const main = [...frame.querySelectorAll("video")].find((v) => !v.hasAttribute("aria-hidden"))!;
    expect(main.className).toMatch(/object-contain/);
  });

  it("Post stays off until 1–5 categories are chosen", async () => {
    render(<VideoPostComposer open onOpenChange={() => {}} initialFile={file} />);
    const postBtn = await screen.findByRole("button", { name: "Post video" });
    await waitFor(() => expect(screen.getByText(/0:30/)).toBeTruthy());
    expect((postBtn as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /add category/ }));
    await waitFor(() => expect((postBtn as HTMLButtonElement).disabled).toBe(false));
  });

  it("a 4-minute video is refused before anything is encoded", async () => {
    vi.mocked(readVideoFacts).mockResolvedValueOnce({ ...facts, durationSeconds: 240 });
    render(<VideoPostComposer open onOpenChange={() => {}} initialFile={file} />);
    expect(await screen.findByText(/This video is 4:00\. Videos can be up to 3:00/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /add category/ }));
    expect((screen.getByRole("button", { name: "Post video" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("a 600 MB video is refused before anything is encoded", async () => {
    vi.mocked(readVideoFacts).mockResolvedValueOnce({ ...facts, bytes: 600 * 1_048_576 });
    render(<VideoPostComposer open onOpenChange={() => {}} initialFile={file} />);
    expect(await screen.findByText(/Videos can be up to 500 MB/)).toBeTruthy();
  });
});
