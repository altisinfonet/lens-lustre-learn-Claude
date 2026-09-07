import type { Variants } from "framer-motion";

/**
 * The page-content reveal, shared — and it starts VISIBLE.
 *
 * ⚠ CONTENT MUST NEVER ANIMATE FROM INVISIBLE. THIS IS F-89's RULE, APPLIED AS
 * A CLASS AFTER F-99 PROVED IT WAS ONLY EVER APPLIED TO ONE INSTANCE.
 *
 * F-89, 2026-09-05: the 404 froze at opacity 0.567406 with an inline
 * `opacity: 0; transform: translateY(2.22352px)` and stayed there. The fix was
 * to animate FROM visible, so an animation that never completes strands the
 * member on a READABLE frame instead of an invisible one.
 *
 * F-99, hours later: /friends froze at opacity 0.530973 and 0.127284, sampled
 * three times over three seconds without moving, inline
 * `opacity: 0; transform: translateY(17.3802px)`. Same signature, different
 * page. Its entire content — Awaited (0), Pending (1), Friends (0),
 * Followers (515), Owen Blake, Request sent — was on the page and unreadable.
 *
 * The reason it recurred is that there was no shared variant to fix. SEVEN
 * pages each declared their own copy: Certificates, Dashboard, Friends,
 * Referrals, Wallet, Winners, Competitions. Six were identical and Dashboard
 * had drifted to y:14. Fixing F-89 fixed one instance of a pattern that existed
 * in eight places.
 *
 * THE TRADE, STATED: starting at opacity 1 removes the fade. The slide is kept,
 * so the reveal still reads as motion. A fade is decoration; content a member
 * cannot read is not a decoration failing, it is the page being blank. An
 * interrupted animation now strands them mid-SLIDE, which is legible.
 *
 * If you are about to set `opacity: 0` here, that is the change that produced
 * both P0s.
 */
export const fadeUp: Variants = {
  hidden: { opacity: 1, y: 20 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: {
      delay: (i ?? 0) * 0.1,
      duration: 0.6,
      ease: [0.4, 0, 0.2, 1] as [number, number, number, number],
    },
  }),
};

/*
 * A props-shaped variant was written for PublicProfile and then removed: its
 * local copy turned out to have ZERO call sites — nine copies of the defect,
 * and one of them was dead code nobody had noticed. An unused export would just
 * be a tenth thing to keep in step, so it is not kept. If a caller ever needs
 * the spread shape, it belongs here, next to fadeUp, sharing its opacity rule.
 */
