import PhaseWatermark from "@/components/competition/PhaseWatermark";

/**
 * Step 22 — Visual QA harness for PhaseWatermark.
 *
 * Public route: /qa/watermark-matrix
 *
 * Renders a deterministic matrix of (phase × surface × round) so we can
 * snapshot the exact watermark contract enforced in Step 20 + Step 21.
 *
 * Gate enforced visually:
 *   - 100% of judging-phase cells render the diagonal overlay.
 *   - 0% of non-judging cells render anything.
 *
 * This is component-level — it does NOT depend on live competition data,
 * auth, or any backend round/phase wiring. Pair with the Step 21 unit
 * tests + the Step 20 surface-coverage guard for full confidence.
 */

const PHASES = ["submission_open", "voting", "judging", "result"] as const;
const SURFACES = ["card", "lightbox", "cinema"] as const;
const ROUNDS: Array<{ key: string; round: string | null }> = [
  { key: "r1", round: "1" },
  { key: "r2", round: "2" },
  { key: "r3", round: "3" },
  { key: "r4", round: "4" },
  { key: "rNull", round: null },
];

// 1×1 transparent placeholder — colour comes from the wrapper so we can
// visually verify the watermark sits over the image without any network deps.
const PLACEHOLDER =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300">
       <defs>
         <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
           <stop offset="0%" stop-color="#1f2937"/>
           <stop offset="100%" stop-color="#374151"/>
         </linearGradient>
       </defs>
       <rect width="400" height="300" fill="url(#g)"/>
       <text x="200" y="158" font-family="sans-serif" font-size="14" fill="#9ca3af" text-anchor="middle">competition photo</text>
     </svg>`,
  );

const WatermarkQAMatrix = () => {
  return (
    <div className="min-h-screen bg-background text-foreground p-6" data-qa-root="watermark-matrix">
      <header className="mb-6">
        <h1
          className="text-2xl font-light tracking-wide"
          style={{ fontFamily: "var(--font-display)" }}
        >
          PhaseWatermark — Visual QA Matrix
        </h1>
        <p
          className="text-xs text-muted-foreground mt-1"
          style={{ fontFamily: "var(--font-body)" }}
        >
          {PHASES.length} phases × {SURFACES.length} surfaces × {ROUNDS.length} rounds ={" "}
          {PHASES.length * SURFACES.length * ROUNDS.length} cells. Only the{" "}
          <code className="text-primary">judging</code> column should show the
          diagonal overlay.
        </p>
      </header>

      {PHASES.map((phase) => (
        <section key={phase} className="mb-10" data-qa-phase={phase}>
          <h2
            className="text-[10px] tracking-[0.3em] uppercase text-muted-foreground mb-3"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            phase = {phase}
          </h2>
          <div className="grid grid-cols-3 gap-4">
            {SURFACES.map((surface) =>
              ROUNDS.map(({ key, round }) => (
                <div
                  key={`${phase}-${surface}-${key}`}
                  data-qa-cell={`${phase}__${surface}__${key}`}
                  data-qa-phase={phase}
                  data-qa-surface={surface}
                  data-qa-round={round ?? "null"}
                  className="border border-border rounded-md overflow-hidden"
                >
                  <div className="px-2 py-1 text-[9px] tracking-[0.2em] uppercase text-muted-foreground bg-muted/30 flex items-center justify-between">
                    <span style={{ fontFamily: "var(--font-heading)" }}>
                      {surface}
                    </span>
                    <span style={{ fontFamily: "var(--font-heading)" }}>
                      round {round ?? "—"}
                    </span>
                  </div>
                  <div className="relative aspect-[4/3]">
                    <img
                      src={PLACEHOLDER}
                      alt={`qa cell ${phase} ${surface} ${key}`}
                      className="w-full h-full object-cover block"
                    />
                    <PhaseWatermark
                      phase={phase}
                      currentRound={round}
                      surface={surface}
                    />
                  </div>
                </div>
              )),
            )}
          </div>
        </section>
      ))}
    </div>
  );
};

export default WatermarkQAMatrix;
