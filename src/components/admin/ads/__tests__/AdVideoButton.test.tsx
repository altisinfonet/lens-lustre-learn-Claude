/**
 * VID-5 · Admin → Advertisements: "Add video" on an ad creative.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

let allowed = true;
vi.mock("@/hooks/core/useFeatureAllowed", () => ({ useFeatureAllowed: () => allowed }));
vi.mock("@/hooks/core/useAuth", () => ({ useAuth: () => ({ user: { id: "11111111-1111-4111-8111-111111111111" } }) }));
vi.mock("@/hooks/core/use-toast", () => ({ toast: vi.fn() }));
vi.mock("@/lib/video/limits", async (orig) => {
  const real = await orig<typeof import("@/lib/video/limits")>();
  return { ...real, readVideoFacts: vi.fn(async () => ({ durationSeconds: 45, bytes: 20_000_000, width: 1080, height: 1920 })) };
});
vi.mock("@/components/post/CategoryChips", () => ({
  default: ({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) => (
    <button type="button" onClick={() => onChange([...value, "travel"])}>add category ({value.length})</button>
  ),
  canPublishCategories: (v: string[]) => v.length >= 1 && v.length <= 5,
}));
const createJob = vi.fn(async (_input: Record<string, unknown>) => ({}));
vi.mock("@/lib/video/uploadJobs", () => ({ createJob: (input: Record<string, unknown>) => createJob(input), runVideoJobs: vi.fn(async () => {}) }));
vi.mock("@/lib/video/jobDeps", () => ({ realJobDeps: {} }));
vi.mock("@/lib/video/webEncoder", () => ({
  encodeVideoToHls: vi.fn(async () => ({ files: new Map(), manifest: { v: 1 }, manifestSha256: "m" })),
}));
const del = vi.fn(async (_c: string, _v: string) => ({ error: null }));
const rpc = vi.fn(async (_f: string, _a: Record<string, unknown>) => ({ data: "deleted", error: null }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { video_id: "old-video" } }) }) }),
      delete: () => ({ eq: (c: string, v: string) => del(c, v) }),
    }),
    rpc: (f: string, a: Record<string, unknown>) => rpc(f, a),
  },
}));
vi.mock("@/lib/ads/adCreatives", () => ({ invalidateAdCreatives: vi.fn() }));

import AdVideoButton from "../AdVideoButton";

beforeEach(() => {
  allowed = true; createJob.mockClear(); del.mockClear();
  (globalThis.URL as unknown as { createObjectURL: () => string }).createObjectURL = () => "blob:x";
  (globalThis.URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {};
});

describe("AdVideoButton", () => {
  it("is not shown at all when Video ads is off for this admin", () => {
    allowed = false;
    const { container } = render(<AdVideoButton creativeId="c1" videoState={null} />);
    expect(container.textContent).toBe("");
  });

  it("says Add video / Replace video, and the state of the current one", () => {
    const { rerender } = render(<AdVideoButton creativeId="c1" videoState={null} />);
    expect(screen.getByRole("button", { name: /Add video/ })).toBeTruthy();
    rerender(<AdVideoButton creativeId="c1" videoState="ready" />);
    expect(screen.getByRole("button", { name: /Replace video/ })).toBeTruthy();
    expect(screen.getByText("Video live")).toBeTruthy();
    rerender(<AdVideoButton creativeId="c1" videoState="pending" />);
    expect(screen.getByText(/not available/)).toBeTruthy();
  });

  it("an upload becomes an AD job for THIS creative (not a post), after 1–5 categories", async () => {
    render(<AdVideoButton creativeId="creative-42" videoState={null} />);
    fireEvent.click(screen.getByRole("button", { name: /Add video/ }));
    const input = await screen.findByLabelText("Choose a video for this ad");
    fireEvent.change(input, { target: { files: [new File([new Uint8Array(4)], "ad.mp4", { type: "video/mp4" })] } });
    const up = await screen.findByRole("button", { name: "Upload video" });
    await waitFor(() => expect(screen.getByText(/0:45/)).toBeTruthy());
    expect((up as HTMLButtonElement).disabled).toBe(true); // no category yet
    fireEvent.click(screen.getByRole("button", { name: /add category/ }));
    await waitFor(() => expect((up as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(up);
    await waitFor(() => expect(createJob).toHaveBeenCalledTimes(1));
    expect(createJob.mock.calls[0][0]).toMatchObject({ purpose: "ad", ad: { creativeId: "creative-42" }, post: { categories: ["travel"] } });
  });

  it("Remove video takes the video off the ad (the picture shows again) and marks the old video deleted", async () => {
    render(<AdVideoButton creativeId="creative-7" videoState="ready" />);
    fireEvent.click(screen.getByRole("button", { name: "Remove the video" }));
    await waitFor(() => expect(del).toHaveBeenCalledWith("ad_creative_id", "creative-7"));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("video_delete", { _video_id: "old-video" }));
  });

  it("a video that is linked but no longer playable says so plainly", () => {
    render(<AdVideoButton creativeId="c1" videoState="pending" />);
    expect(screen.getByText(/Video not available/)).toBeTruthy();
  });
});
