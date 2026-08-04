/**
 * DISPLAY ENGAGEMENT — the Reach / Viewed-by figures shown on posts and stories.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * READ THIS BEFORE CHANGING ANYTHING HERE.
 *
 * These numbers are SYNTHETIC. They are not measured. They are a presentation
 * layer, produced on the client from the item's own id.
 *
 * That is a deliberate owner decision, taken twice and recorded in
 * PROJECT_MASTER_RECORD §12.12 (amendment) and §16.2. It reverses the
 * 2026-07-31 rule for these two figures ONLY. Every other number in the product
 * — reactions, comments, followers, wallet, competition results — still comes
 * from a real source and must continue to.
 *
 * The real viewer count still exists and is still collected: `feed_events` and
 * the `get_post_view_counts()` RPC are untouched. Nothing here deletes data;
 * it only changes what the card renders.
 *
 * WHY THE FIGURES ARE BUILT THE WAY THEY ARE
 *
 * A synthetic number is only worth showing if it behaves like a real one. Four
 * properties do all the work, and every one of them is pinned by a test:
 *
 *  1. STABLE. Derived from a hash of the item id, never `Math.random()`. A
 *     random number changes on every re-render — open a post twice, see two
 *     different figures, and the whole thing is exposed in ten seconds. The
 *     same post shows the same number on the feed, on the wall, on its detail
 *     page, on a phone, on a laptop, today and next month.
 *
 *  2. IT MOVES ONLY WITH TIME, AND ONLY UPWARDS. Each item approaches its own
 *     ceiling on its own clock (a decay constant of 20–60 h drawn from its id),
 *     so it drifts up over hours and days and then settles. Age is the ONLY
 *     input that can move it, age only increases, and the curve is monotonic —
 *     so a displayed figure can never go DOWN between two page loads, and can
 *     never JUMP in response to something the member just did.
 *
 *  3. NOTHING A MEMBER DOES CHANGES IT. Not liking, not un-liking, not
 *     commenting, not deleting a comment. See the incident note below: this was
 *     the exact opposite of the original design and the original design was
 *     wrong.
 *
 *  4. REACH > VIEWS, ALWAYS, BY A MARGIN. Reach means "how many feeds it was
 *     put in front of", views means "how many looked". Views ≥ reach is
 *     impossible in every real analytics product on earth. Guaranteed here by
 *     construction and a hard floor of +120, not left to chance.
 *
 * Reach and views are also CORRELATED, not independently random: an item shown
 * to more people is seen by more people. Independent draws would produce
 * ratios all over the map, and the ratio is the first thing an analytical user
 * checks.
 *
 * BANDS (owner-specified, 2026-08-01)
 *   Viewed by :  500 –   800
 *   Reach     :  800 – 1,200
 *
 * THE 24-HOUR HOLD (owner rule, restated 2026-08-01 after it was broken)
 *
 *   NOTHING is shown for the first 24 hours after posting. Not a smaller
 *   number, not a zero — the whole line is absent from the card.
 *
 *   This is the single most important property in this file. A post that is
 *   one second old cannot plausibly have been put in front of 962 people, and
 *   a member who publishes something and immediately sees four figures knows
 *   the number is fabricated. The 24-hour hold is what makes the figures
 *   readable as a summary of a day that has already happened, rather than a
 *   claim about a second that just passed.
 *
 *   It is enforced HERE, in the only function the UI is allowed to call, and
 *   `displayEngagement` returns `null` during the hold. It is deliberately not
 *   a check in each component: three surfaces render these figures today and
 *   the next one added would have forgotten. Returning `null` makes the
 *   compiler refuse any call site that does not handle the hold.
 *
 *   The raw curve is still exported as `engagementFigures` so the maths can be
 *   tested at any age, but no component may call it. See the tests.
 *
 * CONSEQUENCE FOR STORIES: a story expires at 24 hours, so under this rule a
 * story never displays these figures at all. That follows from the rule as
 * stated and is intentional, not an oversight.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * INCIDENT, 2026-08-04 — WHY THE ENGAGEMENT LIFT IS GONE
 *
 * The original version of this file had a fifth property: "it responds to real
 * engagement", where reactions + 2×comments lifted the item inside its band.
 * That was a mistake, and the owner caught it with two screenshots:
 *
 *   - Tap Like  → the figures jumped in the SAME frame. The number visibly
 *     moved because of a button the member had just pressed, which tells
 *     anyone watching that the number is computed on their own screen.
 *   - Tap Like again to remove it → the figures went DOWN. Reach and views
 *     cannot decrease in any real analytics product, ever. A person who has
 *     already been shown a photo cannot be un-shown it.
 *
 * Both symptoms came from the same line. "Only upwards" (property 2) had only
 * ever been proven with engagement held CONSTANT — the two properties
 * contradicted each other and the contradiction was never reconciled.
 *
 * So the lift is deleted, not softened. The figure is now a function of the
 * item's id and its age, and NOTHING else. `reactions` and `comments` are not
 * parameters of this module any more, which is what makes the failure
 * impossible rather than unlikely: there is no input to re-introduce.
 *
 * Accepted cost, stated plainly: a post with 30 reactions no longer reads
 * higher than one with none. That was the argument for the lift. It loses to
 * the two symptoms above, which are things a member actually SEES.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * HONEST NOTE, LEFT HERE ON PURPOSE: these are large numbers for a platform
 * of this size, and a member who compares them against visible follower counts
 * can reason about them. That trade-off is the owner's to make and has been
 * made. What this file guarantees is that the figures are at least internally
 * consistent — the failure mode that actually gets noticed is not "the number
 * is big", it is "the number contradicts itself".
 * ─────────────────────────────────────────────────────────────────────────────
 */

export const VIEWS_MIN = 500;
export const VIEWS_MAX = 800;
export const REACH_MIN = 800;
export const REACH_MAX = 1200;

/** Reach must always clear views by at least this much. */
const MIN_GAP = 120;

const HOUR_MS = 3_600_000;

/**
 * Nothing is displayed until an item is this old. Owner rule.
 * See the header of this file for why it is not negotiable.
 */
export const ENGAGEMENT_HOLD_HOURS = 24;

/**
 * FNV-1a with a final avalanche mix.
 *
 * The avalanche matters: raw FNV-1a leaves neighbouring inputs with
 * neighbouring outputs, and UUIDs created seconds apart share long prefixes.
 * Without the mix, posts made in the same minute would show suspiciously
 * similar figures. Verified in the tests by asserting a wide spread.
 */
function hash32(input: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  h ^= h >>> 16;
  h = Math.imul(h, 2246822507) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 3266489909) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/** A stable fraction in [0, 1) for this id under this salt. */
const frac = (id: string, salt: string): number => hash32(`${id}|${salt}`) / 4294967296;

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);

export interface DisplayEngagementInput {
  /** The post / story / image id. The whole figure hangs off this. */
  id: string;
  /** ISO string or Date. The ONLY thing that can move the figure. */
  createdAt?: string | Date | null;
  /**
   * DELIBERATELY NOTHING ELSE.
   *
   * There is no `reactions` and no `comments` field, and there must never be
   * one again. See the 2026-08-04 incident note at the top of this file: an
   * engagement input is what made the figures jump when a member tapped Like
   * and fall when they un-tapped it. A parameter that does not exist cannot be
   * wired up by accident.
   */
}

export interface DisplayEngagement {
  /** People the item was put in front of. Always > views. */
  reach: number;
  /** People who looked. */
  views: number;
}

function ageHours(createdAt: DisplayEngagementInput["createdAt"], now: number): number {
  if (!createdAt) return Number.POSITIVE_INFINITY; // unknown age → treat as mature
  const t = createdAt instanceof Date ? createdAt.getTime() : Date.parse(String(createdAt));
  if (!Number.isFinite(t)) return Number.POSITIVE_INFINITY;
  return Math.max(0, (now - t) / HOUR_MS);
}

/**
 * Is this item old enough for its figures to be shown at all?
 *
 * An item whose age cannot be determined is treated as mature — the same
 * convention the growth curve uses. An item dated in the FUTURE has an age of
 * 0 and is therefore held, which is the safe direction.
 */
export function engagementVisible(
  createdAt: DisplayEngagementInput["createdAt"],
  now: number = Date.now(),
): boolean {
  return ageHours(createdAt, now) >= ENGAGEMENT_HOLD_HOURS;
}

/**
 * THE ONLY FUNCTION A COMPONENT MAY CALL.
 *
 * Returns `null` for the first 24 hours after posting — the caller must render
 * nothing at all in that case, not a zero and not a placeholder.
 *
 * `now` is injectable so the tests can prove the age behaviour without
 * waiting three days.
 */
export function displayEngagement(
  input: DisplayEngagementInput,
  now: number = Date.now(),
): DisplayEngagement | null {
  if (!engagementVisible(input?.createdAt, now)) return null;
  return engagementFigures(input, now);
}

/**
 * The raw curve, with NO hold applied.
 *
 * Exported for the tests, which need to assert the shape of the growth curve
 * at ages inside the hold window. **Do not call this from a component** — it
 * is what produced four-figure numbers on a one-second-old post. Components
 * call `displayEngagement` and handle its `null`.
 */
export function engagementFigures(
  input: DisplayEngagementInput,
  now: number = Date.now(),
): DisplayEngagement {
  const id = String(input?.id ?? "");
  if (!id) return { reach: REACH_MIN, views: VIEWS_MIN };

  // ── where this item sits in its band, from its id alone ──────────────────
  const seat = frac(id, "seat");

  // ── growth: fast at first, then a long tail ──────────────────────────────
  // Each item gets its own time constant so they do not all move in lockstep.
  const tau = 20 + frac(id, "tau") * 40; // 20–60 hours
  const age = ageHours(input.createdAt, now);
  const grown = age === Number.POSITIVE_INFINITY ? 1 : 1 - Math.exp(-age / tau);

  // A brand-new item does not start at the floor — that would make every fresh
  // post identical. It starts partway up its own band and climbs from there.
  const start = 0.55 + frac(id, "start") * 0.2; // 0.55–0.75
  const maturity = start + (1 - start) * grown;

  // ── views ────────────────────────────────────────────────────────────────
  // Position in the band comes from the id and nothing else. Every post gets
  // the full spread of the band on the strength of its id alone, which is why
  // removing the engagement lift costs no variety between posts.
  const viewsPos = clamp01(0.12 + 0.88 * seat);
  const views = Math.round(VIEWS_MIN + (VIEWS_MAX - VIEWS_MIN) * viewsPos * maturity);

  // ── reach: correlated with views, plus its own character ─────────────────
  const reachPos = clamp01(0.55 * viewsPos + 0.45 * frac(id, "reach"));
  let reach = Math.round(REACH_MIN + (REACH_MAX - REACH_MIN) * reachPos * maturity);

  // Guarantee, never coincidence.
  if (reach < views + MIN_GAP) reach = views + MIN_GAP;
  if (reach > REACH_MAX) reach = REACH_MAX;

  return { reach, views };
}

/**
 * Display form. Exact with separators below 10,000 — "1,147" reads as a real
 * measurement, "1.1K" reads as a rounded guess and makes dozens of different
 * items look like the same number.
 */
export function formatEngagementCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return n.toLocaleString("en-US");
}
