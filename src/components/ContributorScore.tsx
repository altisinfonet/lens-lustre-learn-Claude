/**
 * The Contributor Score badge, under a member's name on the feed and the wall.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHERE THIS BELONGS, AND WHERE IT DOES NOT
 *
 * Owner, 2026-08-11: "I asked you to show score below the name when user names
 * coming on the Feed / Wall Only, there it will come just below the name
 * (public view, small but nice look with animation in web and app)."
 *
 * So: feed and wall, under the name. The Home page Top Contributors list keeps
 * the score on the RIGHT of the name, on one line — that is a different
 * treatment and it lives in Index.tsx / SidebarTopContributors.tsx. Comments,
 * sidebars and notification rows get nothing.
 *
 * The wall renders through PostCard, so mounting this once in PostCard covers
 * both surfaces and they cannot drift apart.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * IT JOINS THE LINE THAT IS ALREADY THERE
 *
 * PostCard's header is two lines: the name, then a quiet meta line carrying the
 * timestamp and the privacy icon. This sits at the FRONT of that second line
 * rather than adding a third:
 *
 *     Dipannita Sen
 *     ✦ 5,334 · 2h · 🌐
 *
 * That is "just below the name" and costs the card no extra height. On a feed
 * of twenty cards a third line would push real content off every screen.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE ANIMATION
 *
 * The number counts up from zero when the card first scrolls into view — once,
 * via IntersectionObserver, not on every re-render. 700ms, ease-out cubic, so
 * it settles rather than stops.
 *
 * `prefers-reduced-motion: reduce` renders the final value immediately. That is
 * not decoration: counting digits can make some people motion sick, and it is
 * one media query.
 *
 * No layout shift — the element is only mounted once the score is known, and
 * `tabular-nums` keeps every digit the same width so the row does not twitch as
 * the number climbs.
 */
import { useEffect, useRef, useState } from "react";
import { fetchContributorScores, formatContributorScore } from "@/lib/contributorScore";

interface Props {
  userId: string;
}

const DURATION_MS = 700;

const ContributorScore = ({ userId }: Props) => {
  const [score, setScore] = useState<number | null>(null);
  const [shown, setShown] = useState(0);
  const ref = useRef<HTMLSpanElement | null>(null);
  const animated = useRef(false);

  useEffect(() => {
    let alive = true;
    fetchContributorScores([userId]).then((map) => {
      if (!alive) return;
      // Absent means admin, suspended, deleted, or a score of zero. All four
      // render nothing rather than a bare "0".
      setScore(map.get(userId) ?? null);
    });
    return () => {
      alive = false;
    };
  }, [userId]);

  useEffect(() => {
    if (score === null || animated.current) return;

    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    if (reduce) {
      animated.current = true;
      setShown(score);
      return;
    }

    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      animated.current = true;
      setShown(score);
      return;
    }

    let raf = 0;
    let safety = 0;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting) || animated.current) return;
        animated.current = true;
        observer.disconnect();

        const start = performance.now();
        const tick = (now: number) => {
          const t = Math.min(1, (now - start) / DURATION_MS);
          // ease-out cubic
          const eased = 1 - Math.pow(1 - t, 3);
          setShown(Math.round(score * eased));
          if (t < 1) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);

        // WHY A PLAIN TIMER BACKS UP THE ANIMATION FRAMES.
        //
        // requestAnimationFrame does not run while a tab is hidden. That is
        // usually harmless here, because the observer above does not fire in a
        // hidden tab either — measured on production 2026-08-11: an element
        // sitting well inside the viewport of a background tab produced no
        // callback in 2.5 seconds. So the ordinary case is that nothing happens
        // until somebody actually looks, which is exactly right.
        //
        // The gap is the race. If the tab is hidden in the moment between the
        // observer firing and the frames running, the count stops partway, and
        // `animated` is already true so nothing ever restarts it. A timer still
        // fires when hidden (throttled, which is fine), so the real value lands
        // regardless. A public score frozen at a wrong number is far worse than
        // an animation that gets cut short.
        safety = window.setTimeout(() => setShown(score), DURATION_MS + 400);
      },
      { threshold: 0.1 },
    );

    observer.observe(el);
    return () => {
      observer.disconnect();
      if (raf) cancelAnimationFrame(raf);
      if (safety) clearTimeout(safety);
    };
  }, [score]);

  if (score === null) return null;

  return (
    <span
      ref={ref}
      className="inline-flex items-center gap-0.5 text-primary/80 tabular-nums"
      title="Contributor Score"
      aria-label={`Contributor Score ${formatContributorScore(score)}`}
    >
      <span aria-hidden="true">✦</span>
      {/* aria-hidden on the climbing number: a screen reader should announce the
          final value once, from the label above, not every frame of the count. */}
      <span aria-hidden="true">{formatContributorScore(shown)}</span>
    </span>
  );
};

export default ContributorScore;
