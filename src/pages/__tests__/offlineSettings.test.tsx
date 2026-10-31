/**
 * S7b-6 · the member sets the phone budget for saved videos (default 300 MB)
 * and whether videos are saved on Wi-Fi only (default yes), sees how much is
 * used, and can remove them. Reached from Edit Profile.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { readFileSync } from "node:fs";

vi.mock("@/hooks/core/useAuth", () => ({ useAuth: () => ({ user: { id: "me" }, loading: false }) }));
vi.mock("@/components/PageSEO", () => ({ default: () => null }));

import OfflineSettings from "@/pages/OfflineSettings";
import { getVideoOfflineSettings, __resetOfflineVideo, savedVideoUsage } from "@/lib/video/offlineVideo";

beforeEach(() => {
  localStorage.clear();
  __resetOfflineVideo();
  (globalThis as { caches?: unknown }).caches = { delete: async () => true };
});

const page = () => render(<MemoryRouter><OfflineSettings /></MemoryRouter>);

describe("Saved for no internet", () => {
  it("shows the defaults: 300 MB, Wi-Fi only", () => {
    page();
    expect((screen.getByLabelText(/space for saved videos/i) as HTMLSelectElement).value).toBe("300");
    expect((screen.getByLabelText(/only on wi-fi/i) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByText(/0 MB of 300 MB used/i)).toBeTruthy();
  });
  it("the member changes the budget and the Wi-Fi rule; both are kept", () => {
    page();
    fireEvent.change(screen.getByLabelText(/space for saved videos/i), { target: { value: "1000" } });
    fireEvent.click(screen.getByLabelText(/only on wi-fi/i));
    expect(getVideoOfflineSettings()).toEqual({ budgetMB: 1000, wifiOnly: false });
    expect(screen.getByText(/of 1000 MB used/i)).toBeTruthy();
  });
  it("Off is a choice (0 = do not save videos)", () => {
    page();
    fireEvent.change(screen.getByLabelText(/space for saved videos/i), { target: { value: "0" } });
    expect(getVideoOfflineSettings().budgetMB).toBe(0);
  });
  it("shows what is used and removes the saved videos", async () => {
    localStorage.setItem("retina:video-offline:index", JSON.stringify([
      { videoId: "v1", userId: "me", files: ["master.m3u8"], bytes: 5 * 1024 * 1024, seconds: 28, full: false, savedAt: 1 },
    ]));
    __resetOfflineVideo();
    page();
    expect(screen.getByText(/5 MB of 300 MB used · 1 video/i)).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /remove saved videos/i })); });
    expect(savedVideoUsage()).toEqual({ bytes: 0, videos: 0 });
    expect(screen.getByText(/0 MB of 300 MB used/i)).toBeTruthy();
  });
  it("course lessons are YouTube videos: the page says they need a connection", () => {
    page();
    expect(screen.getByText(/course lesson videos.*need a connection/i)).toBeTruthy();
  });
});

describe("how the member gets there", () => {
  it("Edit Profile links to it and the app has the route", () => {
    expect(readFileSync("src/pages/EditProfile.tsx", "utf8")).toContain('to="/settings/offline"');
    expect(readFileSync("src/App.tsx", "utf8")).toMatch(/path="\/settings\/offline"/);
  });
});
