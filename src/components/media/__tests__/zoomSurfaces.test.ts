import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (rel: string) => fs.readFileSync(path.resolve(process.cwd(), rel), "utf8");

/**
 * DELIBERATELY IMPORTS NOTHING FROM THE FEATURE. Every check below reads source
 * off disk instead. A test that imports the new modules cannot be run against
 * `main` at all — it dies on module resolution and reports "no tests", which
 * proves nothing. WORKING_RULES §2 requires a regression test to FAIL on main
 * with real assertions, and this file does: run it on 6b6bfc4 and it reports
 * the dead feed lightbox, the missing shared component and the absent CSS rule
 * one by one.
 */
const ZOOM_LOCK_CLASS = "app-zoom-locked";

/**
 * BUILD 1055 — pins for the zoom work.
 *
 * The audit that preceded this build found SIX separate fullscreen photo
 * viewers, several of them near-identical copies of one another, and one of
 * them dead code that could never open. That is exactly how the codebase got
 * into a state where "the lightbox" had no single answer. These tests exist so
 * the seventh copy cannot be added silently, and so the two structural
 * decisions that make the feature correct cannot be undone by a tidy-up.
 */

/**
 * Every member-facing fullscreen photo surface. APPEND TO THIS LIST when a new
 * one is added — the test below will fail until it goes through the shared
 * component, which is the point.
 *
 * judge/CinemaFullView.tsx is deliberately ABSENT: it is judge-only and has
 * carried its own wheel-driven zoom since long before this build.
 */
const ZOOMABLE_SURFACES = [
  "src/components/post/PostMedia.tsx",
  "src/components/FacebookPhotoGrid.tsx",
  "src/components/Lightbox.tsx",
  "src/components/CompetitionLightbox.tsx",
  "src/components/VotingLightbox.tsx",
  "src/components/profile/FeaturedPhotos.tsx",
];

describe("Every member-facing photo viewer uses the ONE zoom component", () => {
  for (const surface of ZOOMABLE_SURFACES) {
    it(`${surface} renders ZoomableImage`, () => {
      const source = read(surface);
      expect(source).toContain('from "@/components/media/ZoomableImage"');
      expect(source).toContain("<ZoomableImage");
    });
  }
});

describe("ZoomableImage keeps the two structural guarantees", () => {
  // Read inside each case, never at describe scope: a describe body runs at
  // COLLECTION time, so a missing file there aborts the whole file with "no
  // tests" instead of reporting which guarantee is absent. That is the
  // difference between a regression test that explains itself on main and one
  // that just refuses to run.
  const src = () => read("src/components/media/ZoomableImage.tsx");

  it("puts the transform on the <img> and not on a wrapper — the UI must stay still", () => {
    // The motion values are applied in exactly one place, on the image.
    expect(src()).toMatch(/<motion\.img[\s\S]*?style=\{\{\s*scale,\s*x,\s*y,/);
    // and nothing else in the file is a motion element that could take them.
    const motionElements = src().match(/<motion\.[a-z]+/g) ?? [];
    expect(motionElements).toEqual(["<motion.img"]);
  });

  it("opts back in to raw touches with touch-action: none, on the photograph only", () => {
    expect(src()).toContain('touchAction: gesturesFailed ? "auto" : "none"');
  });

  /**
   * These three pin the fix for a defect that shipped in the first cut of 1055
   * and that no desktop test could have caught.
   *
   * The gestures were bound to the WRAPPER, which spans the whole viewer, and
   * the double tap was read from an onClick on it. @use-gesture takes pointer
   * capture on its target, and under capture the browser computes a click's
   * target from the CAPTURING element — so `e.target` was always the wrapper,
   * never the <img>. On a handset that meant a tap on the photograph read as
   * "tapped beside it", bubbled to the backdrop and CLOSED THE VIEWER, and
   * double-tap zoom could never fire at all.
   */
  it("binds gestures to the photograph, not to the wrapper", () => {
    expect(src()).toContain("target: imgRef");
    expect(src()).not.toContain("target: wrapperRef");
  });

  it("reads the double tap off the gesture stream, never off a click event", () => {
    expect(src()).toContain("if (tap) { handleDoubleTapCandidate(px, py); return; }");
    // An onClick on the wrapper is what broke it. The only onClick left is the
    // one on the <img> that stops a tap reaching the backdrop.
    expect(src().match(/onClick=/g) ?? []).toHaveLength(1);
    expect(src()).toContain("onClick={(e) => e.stopPropagation()}");
  });

  it("re-clamps the pan when the device rotates", () => {
    // SPEC §7: "Rotate the device while zoomed → no layout break". Both the
    // photograph's laid-out size and the viewer's change on rotation, so the
    // limits computed before the turn no longer hold.
    expect(src()).toContain('window.addEventListener("orientationchange", reclamp)');
    expect(src()).toContain('window.addEventListener("resize", reclamp)');
  });

  it("logs a gesture failure AT MOST ONCE per mount, or one broken pinch floods the Error Log", () => {
    expect(src()).toContain("loggedFailureRef.current = true");
    expect(src()).toContain('code: "UI-8008"');
  });

  it("reports a photograph that fails to load, so an empty viewer is never silent", () => {
    expect(src()).toContain('code: "UI-8007"');
  });

  it("never logs the photograph's own URL — it identifies a member's post", () => {
    expect(src()).not.toMatch(/detail:\s*\{[^}]*\bsrc\b\s*[,}]/);
    expect(src()).toContain("srcKind");
  });
});

describe("The global lock is app-only and its class name agrees on both sides", () => {
  it("the class name in zoomPolicy.ts and the rule in index.css are the same string", () => {
    // Read as source rather than imported, so this still runs on main. A
    // mismatch here is silent in every way that matters: the CSS is valid, the
    // class applies, and nothing happens.
    expect(read("src/lib/native/zoomPolicy.ts")).toContain(`ZOOM_LOCK_CLASS = "${ZOOM_LOCK_CLASS}"`);
    expect(read("src/index.css")).toContain(`html.${ZOOM_LOCK_CLASS}`);
  });

  it("index.css scopes the rule to the runtime class, never to bare html", () => {
    const css = read("src/index.css");
    expect(css).toContain(`html.${ZOOM_LOCK_CLASS}`);
    expect(css).toMatch(new RegExp(`html\\.${ZOOM_LOCK_CLASS}\\s*\\{[^}]*touch-action:\\s*pan-x pan-y`));
    // A bare `html { touch-action: ... }` would hit the website too.
    expect(css).not.toMatch(/^\s*html\s*\{[^}]*touch-action/m);
  });

  /**
   * ⚠️ THIS ONE PASSES ON `main` TOO, AND IT IS NOT A REGRESSION TEST.
   *
   * WORKING_RULES §2 says a regression test that passes on main should be
   * deleted, and it is right — a green test that was never red proves nothing
   * about the bug it claims to cover. This is kept anyway because it is not
   * claiming to cover a bug: it is a FORWARD guard on the mechanism choice.
   * index.html has never had user-scalable=no; the risk is that some future
   * session reaches for it as a quick fix and silently undoes both the
   * accessibility position and the reason this build used touch-action.
   * Recorded here rather than left to look like a passing regression pin.
   */
  it("FORWARD GUARD (green on main): the viewport meta tag is not used to suppress zoom", () => {
    // SPEC §4: user-scalable=no is ignored by modern engines in many cases and
    // is an accessibility regression. If it ever appears here, the robust
    // mechanism has been quietly swapped for the shortcut it replaced.
    const html = read("index.html");
    expect(html).not.toContain("user-scalable");
    expect(html).not.toContain("maximum-scale");
  });

  it("nothing listens for touchmove or gesturestart — the app had zero before 1055 and must still", () => {
    // Matched as an actual REGISTRATION, not as the word. Both files discuss
    // touchmove in their comments precisely to explain why they do not use it,
    // and a naive substring check would fail on the explanation — the same
    // class of mistake as the comment-stripper that once ate 20,000 characters
    // of WallPosts.tsx (see LOGGING_STANDARD.md).
    const REGISTRATION = /addEventListener\(\s*["'`](touchmove|gesturestart|gesturechange)["'`]/;
    for (const rel of ["src/main.tsx", "src/lib/native/zoomPolicy.ts"]) {
      expect(read(rel)).not.toMatch(REGISTRATION);
    }
  });
});

describe("A feed photograph opens fullscreen", () => {
  const src = () => read("src/components/post/PostMedia.tsx");

  it("both the single-photo post AND the album open the viewer", () => {
    // Before 1055 setLightboxOpen(true) did not exist anywhere in this file:
    // the album's viewer was unreachable and the single-photo post had none.
    const opens = src().match(/setLightboxOpen\(true\)/g) ?? [];
    expect(opens.length).toBeGreaterThanOrEqual(2);
  });

  it("a single tap can never fire a like", () => {
    // The open is scheduled, and a second tap inside the window cancels it and
    // likes instead. If these two ever come apart, tapping to view a friend's
    // photograph starts liking it.
    expect(src()).toContain("useTapOrDoubleTap");
    expect(src()).toMatch(/if \(pendingRef\.current\) \{ clearTimeout\(pendingRef\.current\); pendingRef\.current = null; \}/);
  });

  it("a swipe through an album does not open the viewer", () => {
    expect(src()).toContain("swipedUntilRef");
  });
});

describe("Competition integrity is not weakened by zoom", () => {
  it("the judging-phase photograph stays unzoomable while the watermark is a fixed label", () => {
    const source = read("src/components/CompetitionLightbox.tsx");
    // The watermark does not move with the picture, so a zoomed-and-panned
    // photograph would show a proportionally smaller notice over a magnified
    // entry. During judging the photograph therefore behaves exactly as it did
    // before 1055.
    expect(source).toMatch(/competitionPhase === "judging" \?[\s\S]*?<img/);
  });
});
