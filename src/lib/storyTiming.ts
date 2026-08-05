/**
 * How long a story stays on screen before auto-advancing.
 *
 * Owner, 2026-08-05 (verbatim): "Stories time 5 sec to do it 10 sec to stay."
 * It was 5000. One constant so the feed viewer and the profile viewer can
 * never disagree — pinned by src/lib/__tests__/stories.test.ts.
 */
export const STORY_DISPLAY_MS = 10_000;
