import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import JudgeGuideModal from "../JudgeGuideModal";

/**
 * Spec v3 / Judging v6 contract tests.
 *
 * Replaces the old v5 "tag-only" contract. Asserts that the modal teaches
 * the new workflow:
 *   - R1 = four decision buttons (Accept / Shortlist for R2 / Needs Review / Reject), no tags
 *   - R2-R3 = mandatory 10 SOW criteria + auto-tier from average
 *   - R4 = tags + awards (Winner mandatory; runner-ups / mentions optional)
 *   - Lock vs Declare distinction is taught
 *   - "Marks are private" rule is taught
 */

const SOW_CRITERIA = [
  "LINE", "SHAPE", "FORM", "TEXTURE", "COLOR",
  "SPACE", "TONE", "BALANCE", "LIGHT", "DEPTH",
] as const;

const renderModal = () => render(<JudgeGuideModal open onClose={() => {}} />);

const switchTab = (label: RegExp) => {
  const tabBtn = screen.getByRole("button", { name: label });
  fireEvent.click(tabBtn);
};

const allTabBodies = (): string[] => {
  const bodies: string[] = [];
  for (const label of [/Round 1/i, /Rounds 2-3/i, /Round 4/i, /Hotkeys/i]) {
    switchTab(label);
    bodies.push(document.body.textContent ?? "");
  }
  return bodies;
};

describe("JudgeGuideModal — Spec v3 / v6 contract", () => {
  it("renders the v6 header and Spec v3 subtitle", () => {
    renderModal();
    expect(screen.getByText(/Judge's Guide · v6/i)).toBeInTheDocument();
    expect(screen.getByText(/Spec v3/i)).toBeInTheDocument();
  });

  it("exposes the four Spec v3 tabs (R1 / R2-R3 / R4 / Hotkeys)", () => {
    renderModal();
    expect(screen.getByRole("button", { name: /Round 1/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Rounds 2-3/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Round 4/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Hotkeys/i })).toBeInTheDocument();
  });

  it("R1 tab teaches the four decision buttons and explicitly says no tags", () => {
    renderModal();
    switchTab(/Round 1/i);
    const body = document.body.textContent ?? "";
    expect(body).toMatch(/Accept/);
    expect(body).toMatch(/Shortlist for R2/i);
    expect(body).toMatch(/Needs Review/i);
    expect(body).toMatch(/Reject/);
    expect(body).toMatch(/no tags in r1/i);
  });

  it("R2-R3 tab lists exactly the 10 SOW criteria and teaches mandatory + auto-tier", () => {
    renderModal();
    switchTab(/Rounds 2-3/i);
    for (const c of SOW_CRITERIA) {
      expect(screen.getByText(c, { selector: "span" })).toBeInTheDocument();
    }
    const body = document.body.textContent ?? "";
    expect(body).toMatch(/all 10 are required/i);
    expect(body).toMatch(/auto-tier from average/i);
    expect(body).toMatch(/marks are private/i);
  });

  it("R4 tab states Winner is mandatory and runner-ups are optional", () => {
    renderModal();
    switchTab(/Round 4/i);
    const body = document.body.textContent ?? "";
    expect(body).toMatch(/winner.*mandatory/i);
    expect(body).toMatch(/runner up.*optional/i);
    expect(body).toMatch(/locking.*declaring/i);
  });

  it("never re-introduces the v5 'tag-only' wording", () => {
    renderModal();
    const bodies = allTabBodies();
    for (const body of bodies) {
      expect(body).not.toMatch(/judging v5 is/i);
      expect(body).not.toMatch(/\btag-only\b/i);
    }
  });

  it("never advertises 0–9 / 0–10 numeric hotkeys", () => {
    renderModal();
    switchTab(/Hotkeys/i);
    const body = document.body.textContent ?? "";
    expect(body).not.toMatch(/\b0\s*[–-]\s*9\b/);
    expect(body).not.toMatch(/\b0\s*[–-]\s*10\b/);
  });
});
