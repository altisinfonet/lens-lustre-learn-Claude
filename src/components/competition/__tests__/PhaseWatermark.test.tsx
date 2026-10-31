/**
 * Step 21 — Vitest guard for PhaseWatermark.
 *
 * Snapshot per surface for phase='judging' + per-round labels.
 * Failure of these tests = a regression in the watermark contract:
 *   - A surface forgot to render PhaseWatermark, OR
 *   - The label/markup for a round changed unexpectedly.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import PhaseWatermark from "@/components/competition/PhaseWatermark";

/**
 * WHY THIS MOCK EXISTS — 18 failing tests, repaired 2026-08-09.
 *
 * These tests were red for weeks and were written off as "stale tests pinning
 * rules that were deliberately removed". They were nothing of the sort. Every
 * assertion below still describes behaviour the app is supposed to have.
 *
 * What actually happened: Step 23 gave PhaseWatermark a role-based bypass, so
 * the component now calls useCanBypassWatermark → useUserRoles → useQueryClient.
 * These tests render it bare, with no QueryClientProvider above it, so React
 * Query threw "No QueryClient set" before a single assertion could run. The
 * COMPONENT was fine; the HARNESS had not kept up.
 *
 * The role lookup is mocked rather than wrapped in a real provider because
 * these tests are about the watermark's rendering contract, not about how roles
 * are fetched — and a mock lets the bypass itself be tested in both states,
 * which a bare render never could.
 */
const roles = vi.hoisted(() => ({ canBypass: false }));

vi.mock("@/hooks/competition/useCanBypassWatermark", () => ({
  useCanBypassWatermark: () => ({ canBypass: roles.canBypass, loading: false }),
}));

beforeEach(() => {
  // Default viewer is the public/entry owner — the audience the watermark is
  // FOR. Individual tests opt into the privileged case explicitly.
  roles.canBypass = false;
});

const SURFACES = ["card", "lightbox", "cinema"] as const;
/**
 * THE LABEL IS ALWAYS GENERIC — and that is the point, not an oversight.
 *
 * These cases used to assert a per-round label ("Round 1 · Scoring", …). That
 * rule was deliberately removed on 2026-05-02 and the tests were never updated,
 * which is why they sat red: `competitions.current_round` advances the moment
 * judges OPEN the next round, which is BEFORE results are declared. Rendering
 * it painted unpublished round names onto the participant gallery — the "fake
 * update" the owner reported.
 *
 * So the assertion is inverted. Instead of checking WHICH round is shown, each
 * case now proves the round is NOT leaked, whatever it is set to. That is the
 * rule the app actually has to keep, and nothing was testing it before.
 */
const GENERIC_LABEL = "Judging in Progress";
const ROUNDS = [
  { round: "1", mustNotLeak: ["Round 1", "Scoring"] },
  { round: "2", mustNotLeak: ["Round 2", "Shortlisting"] },
  { round: "3", mustNotLeak: ["Round 3", "Finals"] },
  { round: "4", mustNotLeak: ["Round 4", "Winners"] },
  { round: null, mustNotLeak: [] },
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
      for (const { round, mustNotLeak } of ROUNDS) {
        it(`shows the generic label and never leaks round=${round}`, () => {
          const { container, getByText } = render(
            <PhaseWatermark
              phase="judging"
              currentRound={round}
              surface={surface}
            />,
          );
          expect(getByText(GENERIC_LABEL)).toBeInTheDocument();

          // THE RULE: an unpublished round name must never reach a participant.
          const rendered = container.textContent ?? "";
          for (const leak of mustNotLeak) {
            expect(
              rendered,
              `round label "${leak}" leaked onto the participant gallery`,
            ).not.toContain(leak);
          }

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
            Judging in Progress
          </span>
        </div>
      </div>
    `);
  });
});

/**
 * THE BYPASS ITSELF — the behaviour that broke these tests, now pinned.
 *
 * Policy locked 2026-04-18 (see useCanBypassWatermark): judges and admins
 * evaluate clean imagery; the public and the entry owner see the watermark.
 * Nothing tested this at the component level, which is precisely why adding it
 * could silently take 18 tests down without anybody noticing what it changed.
 */
describe("PhaseWatermark — role-based bypass", () => {
  it("shows the watermark to an ordinary viewer during judging", () => {
    roles.canBypass = false;
    const { container } = render(<PhaseWatermark phase="judging" currentRound="1" />);
    expect(container.firstChild).not.toBeNull();
  });

  it("renders nothing for a judge or admin — they must see clean imagery", () => {
    roles.canBypass = true;
    const { container } = render(<PhaseWatermark phase="judging" currentRound="1" />);
    expect(container.firstChild).toBeNull();
  });

  it("the bypass cannot resurrect the watermark outside the judging phase", () => {
    roles.canBypass = false;
    const { container } = render(<PhaseWatermark phase="result" currentRound="4" />);
    expect(container.firstChild).toBeNull();
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
