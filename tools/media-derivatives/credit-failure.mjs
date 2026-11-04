/**
 * CREDIT U3 · what the sweep does with a photo that cannot be drawn. One bad
 * photo must not stop the others, must not turn the run red every 15 minutes,
 * and must not be retried forever.
 *
 * The route counts the failure (photo_credit_failure, 20261110_0111). After
 * PARK_AFTER failures the queues leave the photo out, except for one try a day.
 * The run goes red exactly once for it, on the failure that parks it, so the
 * Owner's alarm e-mail says something once. Everything else is a logged count.
 */
import { appendFileSync } from "node:fs";

/** Keep equal to photo_credit_parked() in supabase/migrations/20261110_0111_photo_set_credit.sql. */
export const PARK_AFTER = 5;

/** `post` sends one JSON body to the worker's route and returns the fetch Response. Never throws. */
export async function reportFailure(post, body, why, stats) {
  stats.failed++;
  try {
    const res = await post({ ...body, error: why });
    const { attempts } = await res.json();
    if (attempts === PARK_AFTER) stats.parked_now++;
  } catch (e) {
    console.log(`could not report a failed photo: ${e.message}`);
  }
}

export const sweepExitCode = (stats) => (stats.parked_now > 0 ? 3 : 0);

/** One line in the run's summary page. Counts only. */
export function sweepSummary(name, stats, parkedTotal) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;
  appendFileSync(file, `${name}: ${JSON.stringify(stats)}; parked in total: ${parkedTotal}\n`);
}
