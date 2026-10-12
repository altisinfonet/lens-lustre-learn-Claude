/**
 * R-104 · the upload screen's rules, as the member meets them:
 *   • every video previews in the 9:16 card (Owner 2026-10-05): a 9:16 video
 *     fills it; a 16:9 one is fitted whole with a blurred fill above and below;
 *   • over 3 minutes or over 500 MB → said before encoding, Post stays off;
 *   • Post stays off until 1–5 categories are chosen;
 *   • the cover: untouched, a picked frame, or an uploaded picture (Owner 2026-10-11).
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
const IMAGE_COVER = new Uint8Array([0xff, 0xd8, 0xff, 1]);
const FRAME_COVER = new Uint8Array([0xff, 0xd8, 0xff, 2]);
vi.mock("@/lib/video/cover", () => ({
  coverFromImage: vi.fn(async () => IMAGE_COVER),
  coverFromVideoAt: vi.fn(async () => FRAME_COVER),
}));
vi.mock("@/lib/video/uploadJobs", () => ({ createJob: vi.fn(async () => ({})), runVideoJobs: vi.fn(async () => {}) }));
vi.mock("@/lib/video/jobDeps", () => ({ realJobDeps: {} }));

import VideoPostComposer from "../VideoPostComposer";
import { readVideoFacts } from "@/lib/video/limits";
import { coverFromImage, coverFromVideoAt } from "@/lib/video/cover";

beforeEach(() => {
  (globalThis.URL as unknown as { createObjectURL: () => string }).createObjectURL = () => "blob:x";
  (globalThis.URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {};
});

const file = new File([new Uint8Array(10)], "v.mp4", { type: "video/mp4" });

describe("VideoPostComposer", () => {
  it("the preview fills the dialog's width (no empty strip beside it), 9:16 capped by the screen, blurred copy behind", async () => {
    render(<VideoPostComposer open onOpenChange={() => {}} initialFile={file} />);
    const frame = await screen.findByTestId("video-preview-frame");
    await waitFor(() => expect(screen.getByText(/0:30/)).toBeTruthy());
    expect(frame.getAttribute("data-frame-aspect")).toBe("0.563");
    expect(frame.style.width).toBe("100%");
    expect(frame.style.maxHeight).toBe("62dvh");
    expect(frame.className).not.toMatch(/max-w-|mx-auto/);
    expect(frame.querySelectorAll("video").length).toBe(2); // the blurred copy + the video
    const main = [...frame.querySelectorAll("video")].find((v) => !v.hasAttribute("aria-hidden"))!;
    expect(main.className).toMatch(/object-contain/); // never cropped
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

  it("no time limit (Owner 2026-10-11): the Owner's 7:28 video can be posted, and says how long preparing takes", async () => {
    vi.mocked(readVideoFacts).mockResolvedValueOnce({ ...facts, durationSeconds: 448, bytes: 91 * 1_048_576 });
    render(<VideoPostComposer open onOpenChange={() => {}} initialFile={file} />);
    expect(await screen.findByText(/Up to 500 MB, any length/)).toBeTruthy();
    expect((await screen.findByTestId("video-long-note")).textContent).toMatch(/about its own length \(7:28\)/);
    expect(screen.queryByText(/Videos can be up to/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /add category/ }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Post video" }) as HTMLButtonElement).disabled).toBe(false));
  });

  it("a video too long for this browser's memory says so, and Remove sound is offered as the way out", async () => {
    vi.mocked(readVideoFacts).mockResolvedValueOnce({ ...facts, durationSeconds: 3 * 3600, bytes: 400 * 1_048_576 });
    render(<VideoPostComposer open onOpenChange={() => {}} initialFile={file} />);
    expect(await screen.findByText(/too long for this browser|Remove sound/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /add category/ }));
    expect((screen.getByRole("button", { name: "Post video" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("a 600 MB video is refused before anything is encoded", async () => {
    vi.mocked(readVideoFacts).mockResolvedValueOnce({ ...facts, bytes: 600 * 1_048_576 });
    render(<VideoPostComposer open onOpenChange={() => {}} initialFile={file} />);
    expect(await screen.findByText(/Videos can be up to 500 MB/)).toBeTruthy();
  });
  describe("the cover (Owner 2026-10-11: choose a frame or upload a picture)", () => {
    const fakeEncode = () => vi.fn(async () => ({ files: new Map(), manifest: {} as never, manifestSha256: "x" }));
    const ready = async () => {
      await waitFor(() => expect(screen.getByText(/0:30/)).toBeTruthy());
      fireEvent.click(screen.getByRole("button", { name: /add category/ }));
      const postBtn = screen.getByRole("button", { name: "Post video" }) as HTMLButtonElement;
      await waitFor(() => expect(postBtn.disabled).toBe(false));
      return postBtn;
    };

    it("untouched → no cover is passed, so the encoder keeps its frame at 1 s", async () => {
      const encode = fakeEncode();
      render(<VideoPostComposer open onOpenChange={() => {}} initialFile={file} encode={encode} />);
      fireEvent.click(await ready());
      await waitFor(() => expect(encode).toHaveBeenCalled());
      expect((encode.mock.calls[0] as unknown[])[1]).toMatchObject({ poster: undefined });
      expect(screen.queryByTestId("video-cover")?.getAttribute("data-cover-kind") ?? "default").toBe("default");
    });

    it("sliding to a frame → that frame (at that time) is the cover", async () => {
      const encode = fakeEncode();
      render(<VideoPostComposer open onOpenChange={() => {}} initialFile={file} encode={encode} />);
      const postBtn = await ready();
      fireEvent.change(screen.getByRole("slider", { name: "Slide to choose a frame" }), { target: { value: "12.5" } });
      expect(screen.getByTestId("video-cover").getAttribute("data-cover-kind")).toBe("frame");
      fireEvent.click(postBtn);
      await waitFor(() => expect(encode).toHaveBeenCalled());
      expect(vi.mocked(coverFromVideoAt)).toHaveBeenCalledWith(file, 12.5);
      expect((encode.mock.calls[0] as unknown[])[1]).toMatchObject({ poster: FRAME_COVER });
    });

    it("uploading a picture → exactly that picture's JPEG is the cover, and the slider goes away", async () => {
      const encode = fakeEncode();
      render(<VideoPostComposer open onOpenChange={() => {}} initialFile={file} encode={encode} />);
      const postBtn = await ready();
      const pic = new File([new Uint8Array(5)], "cover.png", { type: "image/png" });
      fireEvent.change(screen.getByLabelText("Upload a cover image", { selector: "input" }), { target: { files: [pic] } });
      await waitFor(() => expect(screen.getByTestId("video-cover").getAttribute("data-cover-kind")).toBe("image"));
      expect(vi.mocked(coverFromImage)).toHaveBeenCalledWith(pic);
      expect(screen.queryByRole("slider")).toBeNull();
      expect(screen.getByRole("img", { name: "Your cover" })).toBeTruthy();
      fireEvent.click(postBtn);
      await waitFor(() => expect(encode).toHaveBeenCalled());
      expect((encode.mock.calls[0] as unknown[])[1]).toMatchObject({ poster: IMAGE_COVER });
    });

    it("a picture the browser can't open is said at once, and the video's own cover stays", async () => {
      vi.mocked(coverFromImage).mockRejectedValueOnce(new Error("VID-COVER-004: We couldn't open that image. Choose a JPEG, PNG or WebP picture."));
      render(<VideoPostComposer open onOpenChange={() => {}} initialFile={file} />);
      await ready();
      const pic = new File([new Uint8Array(5)], "cover.heic", { type: "image/heic" });
      fireEvent.change(screen.getByLabelText("Upload a cover image", { selector: "input" }), { target: { files: [pic] } });
      expect(await screen.findByText("We couldn't open that image. Choose a JPEG, PNG or WebP picture.")).toBeTruthy();
      expect(screen.getByTestId("video-cover").getAttribute("data-cover-kind")).toBe("default");
      expect((screen.getByRole("button", { name: "Post video" }) as HTMLButtonElement).disabled).toBe(false);
    });
  });
});
