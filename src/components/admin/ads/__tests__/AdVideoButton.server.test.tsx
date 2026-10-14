/**
 * Server conversion · "Add video" on an ad creative when the site says
 * "server": the original goes up instead of being encoded here, for THIS
 * creative; "Remove sound" (device-only) is not offered; VID-SRC-001 turns
 * the dialog back into the device path.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

let setting: unknown = "server";
vi.mock("@/lib/siteSettingsCache", () => ({ getSiteSetting: async () => setting, invalidateSiteSetting: () => {} }));
vi.mock("@/hooks/core/useFeatureAllowed", () => ({ useFeatureAllowed: () => true }));
const USER = "11111111-1111-4111-8111-111111111111";
vi.mock("@/hooks/core/useAuth", () => ({ useAuth: () => ({ user: { id: USER } }) }));
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
const { deps } = vi.hoisted(() => ({ deps: { fake: true } }));
vi.mock("@/lib/video/jobDeps", () => ({ realJobDeps: deps }));
const encodeVideoToHls = vi.fn(async () => ({ files: new Map(), manifest: { v: 1 }, manifestSha256: "m" }));
vi.mock("@/lib/video/webEncoder", () => ({ encodeVideoToHls: () => encodeVideoToHls() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: () => ({}), rpc: async () => ({ data: null, error: null }) } }));
vi.mock("@/lib/ads/adCreatives", () => ({ invalidateAdCreatives: vi.fn() }));
type Start = { kind: "started"; jobId: string } | { kind: "switched_off" } | { kind: "refused"; message: string };
let answer: Start = { kind: "started", jobId: "j1" };
const startOnServer = vi.fn(async (_i: unknown, _d: unknown): Promise<Start> => answer);
vi.mock("@/lib/video/startOnServer", () => ({ startOnServer: (i: unknown, d: unknown) => startOnServer(i, d) }));

import AdVideoButton from "../AdVideoButton";

beforeEach(() => {
  setting = "server"; answer = { kind: "started", jobId: "j1" };
  startOnServer.mockClear(); createJob.mockClear(); encodeVideoToHls.mockClear();
  (globalThis.URL as unknown as { createObjectURL: () => string }).createObjectURL = () => "blob:x";
  (globalThis.URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {};
});

const file = new File([new Uint8Array(10)], "ad.mp4", { type: "video/mp4" });
async function openAndPick() {
  render(<AdVideoButton creativeId="c1" videoState={null} />);
  fireEvent.click(screen.getByRole("button", { name: /Add video/ }));
  await waitFor(() => expect(screen.getByTestId("ad-video-dialog").getAttribute("data-conversion")).toBe("server"));
  fireEvent.change(screen.getByLabelText("Choose a video for this ad"), { target: { files: [file] } });
  await waitFor(() => expect(screen.getByText(/0:45/)).toBeTruthy());
  fireEvent.click(screen.getByRole("button", { name: /add category/ }));
}
const uploadBtn = () => screen.getByRole("button", { name: "Upload video" }) as HTMLButtonElement;

describe("AdVideoButton · server conversion", () => {
  it("uploads the original for THIS creative (no encode here, no Remove sound) and closes", async () => {
    await openAndPick();
    expect(screen.queryByText("Remove sound")).toBeNull();
    expect(screen.getByTestId("ad-video-server-note")).toBeTruthy();
    await waitFor(() => expect(uploadBtn().disabled).toBe(false));
    fireEvent.click(uploadBtn());
    await waitFor(() => expect(screen.queryByTestId("ad-video-dialog")).toBeNull());
    expect(startOnServer).toHaveBeenCalledWith({
      userId: USER, purpose: "ad", file, name: "ad.mp4", post: { content: "", categories: ["travel"], privacy: "public" }, ad: { creativeId: "c1" },
    }, deps);
    expect(encodeVideoToHls).not.toHaveBeenCalled();
    expect(createJob).not.toHaveBeenCalled();
  });

  it("VID-SRC-001 → prepared on this device after all, said in the dialog", async () => {
    answer = { kind: "switched_off" };
    await openAndPick();
    await waitFor(() => expect(uploadBtn().disabled).toBe(false));
    fireEvent.click(uploadBtn());
    expect(await screen.findByTestId("ad-video-server-off")).toBeTruthy();
    expect(screen.getByTestId("ad-video-dialog").getAttribute("data-conversion")).toBe("device");
    expect(screen.getByText("Remove sound")).toBeTruthy();
    await waitFor(() => expect(uploadBtn().disabled).toBe(false));
    fireEvent.click(uploadBtn());
    await waitFor(() => expect(createJob).toHaveBeenCalledWith(expect.objectContaining({ purpose: "ad", ad: { creativeId: "c1" } })));
    expect(encodeVideoToHls).toHaveBeenCalled();
  });
});
