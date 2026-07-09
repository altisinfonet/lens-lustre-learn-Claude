/**
 * Step 21 — Vitest guard for PhaseWatermark.
 *
 * Snapshot per surface for phase='judging' + per-round labels.
 * Failure of these tests = a regression in the watermark contract:
 *   - A surface forgot to render PhaseWatermark, OR
 *   - The label/markup for a round changed unexpectedly.
 */

import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import PhaseWatermark from "@/components/competition/PhaseWatermark";

const SURFACES = ["card", "lightbox", "cinema"] as const;
const ROUNDS = [
  { round: "1", label: "Round 1 · Scoring" },
  { round: "2", label: "Round 2 · Shortlisting" },
  { round: "3", label: "Round 3 · Finals" },
  { round: "4", label: "Round 4 · Winners" },
  { round: null, label: "Judging in Progress" },
] as const;

describe("PhaseWatermark — judging-phase contract", () => {
  it("renders nothing when phase !== 'judging'", () => {
    const { container } = render(
      <PhaseWatermark phase="voting" currentRound="1" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when phase is 'result'", () => {
    const { container } = render(
      <PhaseWatermark phase="result" currentRound={null} />,
    );
    expect(container.firstChild).toBeNull();
  });

  for (const surface of SURFACES) {
    describe(`surface="${surface}"`, () => {
      for (const { round, label } of ROUNDS) {
        it(`renders watermark with label "${label}" for round=${round}`, () => {
          const { container, getByText } = render(
            <PhaseWatermark
              phase="judging"
              currentRound={round}
              surface={surface}
            />,
          );
          expect(getByText(label)).toBeInTheDocument();
          // pointer-events guard — must never block UI
          const overlay = container.querySelector("div");
          expect(overlay?.className).toContain("pointer-events-none");
          expect(overlay?.className).toContain("select-none");
          // surface attribute plumbed through
          const span = container.querySelector("span[data-surface]");
          expect(span?.getAttribute("data-surface")).toBe(surface);
        });
      }
    });
  }

  it("snapshot — judging / round 1 / cinema surface", () => {
    const { container } = render(
      <PhaseWatermark phase="judging" currentRound="1" surface="cinema" />,
    );
    expect(container.firstChild).toMatchInlineSnapshot(`
      <div
        class="absolute inset-0 flex items-center justify-center pointer-events-none select-none z-[5]"
      >
        <div
          class="px-6 py-3 rounded-lg bg-background/10 backdrop-blur-[2px]"
        >
          <span
            class="text-[24px] md:text-[40px] font-bold uppercase tracking-[0.25em] text-foreground/[0.08] rotate-[-25deg] whitespace-nowrap block"
            data-surface="cinema"
            style="font-family: var(--font-display); text-shadow: 0 1px 2px rgba(0,0,0,0.1);"
          >
            Round 1 · Scoring
          </span>
        </div>
      </div>
    `);
  });
});

/**
 * Static surface-coverage guard.
 *
 * If a NEW competition surface is added to the codebase, append it here.
 * The matching grep test below will fail until PhaseWatermark is mounted in
 * the new surface — providing a CI gate for the "every surface watermarked"
 * contract enforced in Step 20.
 */
const REQUIRED_SURFACES = [
  "src/components/EntryCard.tsx",
  "src/components/CompetitionLightbox.tsx",
  "src/components/JuryImageViewer.tsx",
  "src/components/judge/CinemaFullView.tsx",
  "src/components/judge/CinemaListView.tsx",
  "src/components/judge/CinemaJudgeView.tsx",
  "src/components/judge/VirtualizedPhotoGrid.tsx",
  "src/components/judge/MobileJudgeView.tsx",
  "src/pages/EntryDetail.tsx",
  "src/pages/SubmissionDetail.tsx",
  "src/pages/Dashboard.tsx",
  "src/pages/PublicProfile.tsx",
  "src/components/admin/AdminEntriesSection.tsx",
];

describe("Surface-coverage guard — every required surface mounts PhaseWatermark", () => {
  for (const surface of REQUIRED_SURFACES) {
    it(`${surface} imports & uses PhaseWatermark`, async () => {
      const fs = await import("node:fs");
      const path = await import("node:path");
      const abs = path.resolve(process.cwd(), surface);
      const src = fs.readFileSync(abs, "utf8");
      expect(
        src.includes("PhaseWatermark"),
        `${surface} is missing PhaseWatermark — Step 20 contract broken`,
      ).toBe(true);
    });
  }
});
