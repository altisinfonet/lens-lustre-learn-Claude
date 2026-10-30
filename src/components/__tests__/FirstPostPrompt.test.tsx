import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

let native = false;
vi.mock("@/lib/native/authDeepLink", () => ({ isNativeCapacitorApp: () => native }));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ data: [
    { slug: "street", name: "Street", is_active: true },
    { slug: "wildlife", name: "Wildlife", is_active: true },
  ] }),
}));
vi.mock("@/i18n/I18nContext", () => ({ useT: () => (_k: string, fallback?: string) => fallback ?? _k }));

import FirstPostPrompt from "@/components/FirstPostPrompt";
import { takeFirstPostFiles } from "@/lib/firstPost/firstPostNudge";

function Where() {
  const l = useLocation();
  return <div data-testid="where">{l.pathname + l.search}</div>;
}

function setup(interests: string[]) {
  const onClose = vi.fn();
  render(
    <MemoryRouter initialEntries={["/home"]}>
      <Routes><Route path="*" element={<><Where /><FirstPostPrompt open interests={interests} onClose={onClose} /></>} /></Routes>
    </MemoryRouter>,
  );
  return { onClose };
}

beforeEach(() => { native = false; takeFirstPostFiles(); });

describe("Share your first photo — the step after the welcome form", () => {
  it("shows one Choose-a-photo button, a Later link and the verified promise", () => {
    setup(["street"]);
    expect(screen.getByText("Share your first photo")).toBeTruthy();
    expect(screen.getByTestId("first-post-choose").textContent).toContain("Choose a photo");
    expect(screen.getByTestId("first-post-later").textContent).toBe("Later");
    expect(screen.getByTestId("first-post-promise").textContent).toMatch(/share of its places for photographers they haven't seen much of yet/);
    expect(screen.getByTestId("first-post-promise").textContent).not.toMatch(/\d+ of every \d+/);
    expect(screen.getByTestId("first-post-interest").textContent).toContain("Street");
  });

  it("Later closes it and goes nowhere (never a forced block)", () => {
    const { onClose } = setup(["street"]);
    fireEvent.click(screen.getByTestId("first-post-later"));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("where").textContent).toBe("/home");
  });

  it("web: the chosen photo opens the normal post flow with the category filled in", () => {
    const { onClose } = setup(["not-a-category", "wildlife"]);
    const file = new File(["x"], "first.jpg", { type: "image/jpeg" });
    fireEvent.change(screen.getByTestId("first-post-file"), { target: { files: [file] } });
    expect(onClose).toHaveBeenCalled();
    expect(screen.getByTestId("where").textContent).toBe("/feed?compose=1&cat=wildlife&first=1");
    expect(takeFirstPostFiles()).toEqual([file]);
  });

  it("web: cancelling the picker stays on the step", () => {
    const { onClose } = setup(["street"]);
    fireEvent.change(screen.getByTestId("first-post-file"), { target: { files: [] } });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId("where").textContent).toBe("/home");
  });

  it("app: the button opens the app's post flow (native picker first)", () => {
    native = true;
    setup(["street"]);
    fireEvent.click(screen.getByTestId("first-post-choose"));
    expect(screen.getByTestId("where").textContent).toBe("/feed?compose=1&cat=street");
  });

  it("no valid interest: no pre-fill and no invented interest line", () => {
    setup(["gone"]);
    expect(screen.queryByTestId("first-post-interest")).toBeNull();
    native = false;
  });
});
