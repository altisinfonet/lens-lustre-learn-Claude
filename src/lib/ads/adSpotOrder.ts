/**
 * AD SPOTS STAY PUT — the admin library's ordering rules (Instagram-like).
 *
 * Owner, 2026-10-29: deleting the 2nd ad and uploading a new picture showed an
 * OLDER ad in the 2nd spot, still carrying its own likes and comments, while
 * the new picture went to the end. The feed shows picture #N in spot N, so the
 * fix is in how the admin screen numbers pictures — the feed is unchanged:
 *
 *   * a new picture takes a freed spot (a gap left by a delete) before it goes
 *     after the last one;
 *   * "Replace picture" puts the new picture in the SAME spot (a new ad: its
 *     likes, comments and shares start at 0; the old ad's go with it);
 *   * Move up / Move down change the order on purpose, never by accident.
 *
 * Pure functions only, so the rules are tested without a database.
 */
export interface SpotRow {
  id: string;
  sort_order: number;
}

/**
 * sort_order values for `count` new pictures: freed spots first (lowest
 * first), then after the last picture. An empty library starts at 0.
 */
export const spotsForNew = (rows: readonly SpotRow[], count: number): number[] => {
  const used = new Set(rows.map((r) => r.sort_order));
  const max = rows.length ? Math.max(...rows.map((r) => r.sort_order)) : -1;
  const out: number[] = [];
  for (let s = 0; s <= max && out.length < count; s++) if (!used.has(s)) out.push(s);
  let next = max + 1;
  while (out.length < count) out.push(next++);
  return out;
};

/**
 * The writes that number `rows` 0, 1, 2 … in the order given. Rows already on
 * their number are not written. Used after Move up / Move down, and before a
 * Replace when two pictures share a number (so the new one cannot land after
 * its twin).
 */
export const renumberWrites = (rows: readonly SpotRow[]): SpotRow[] =>
  rows.flatMap((r, i) => (r.sort_order === i ? [] : [{ id: r.id, sort_order: i }]));

/** True when another picture shares this one's number. */
export const sharesSpot = (rows: readonly SpotRow[], id: string): boolean => {
  const me = rows.find((r) => r.id === id);
  return !!me && rows.some((r) => r.id !== id && r.sort_order === me.sort_order);
};

/** `rows` with the row at `index` moved one place up (-1) or down (+1). Same array when it cannot move. */
export const movedOne = <T>(rows: readonly T[], index: number, delta: -1 | 1): readonly T[] => {
  const to = index + delta;
  if (index < 0 || index >= rows.length || to < 0 || to >= rows.length) return rows;
  const next = rows.slice();
  [next[index], next[to]] = [next[to], next[index]];
  return next;
};
