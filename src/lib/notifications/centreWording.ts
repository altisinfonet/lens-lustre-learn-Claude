/**
 * N7 · app wording for the notification types that have no person behind them
 * (competitions, wallet, account, announcements). Today these rows show only
 * the text the database wrote. With the centre rows on (notif_centre_ui), the
 * row leads with a short app headline and keeps the server text underneath as
 * the detail — the server text carries the specifics (which competition, which
 * award), so nothing a member sees today is lost.
 *
 * Types with a person behind them already have app sentences in
 * describe.ts ACTION_CATALOG; they get no headline. centreWording.test.ts
 * fails if any member type in the registry (20261104_0110) has neither.
 *
 * Big moments (awards, features, a certificate) render as a highlighted card.
 */
type Headline = { key: string; fallback: string };

const HEADLINES: Record<string, string> = {
  competition_vote: "New vote on your entry",
  entry_approved: "Entry approved",
  entry_rejected: "Update on your entry",
  entry_shortlisted: "Entry shortlisted",
  entry_qualified: "Entry qualified",
  entry_qualified_round: "Through to the next round",
  entry_finalist: "You're a finalist",
  entry_award: "You won an award",
  competition_winner: "Your entry won an award",   // every award level (runner-up, Top 100 …), not only first
  round_published: "New round published",
  round_results_published: "Round results are out",
  needs_review: "Your entry needs a look",
  new_competition: "New competition",
  badge_awarded: "New badge",
  certificate_issued: "Your certificate is ready",
  potd_featured: "Your photo is Photo of the Day",
  featured_artist: "You're a featured artist",
  journal_published: "New journal story",
  course_published: "New course",
  birthday: "Birthday today",   // a friend's — the detail names them
  first_post_reminder: "Share your first photo",
  video_taken_down: "Video removed",
  verification_required: "Verification needed",
  ticket_reply: "Support replied",
  role_approved: "Role approved",
  role_rejected: "Role application update",
  deposit_approved: "Deposit approved",
  deposit_rejected: "Deposit not approved",
  admin_verification_pending: "Verification pending",
  admin_verification_submitted: "Verification submitted",
  admin_announcement: "Announcement",   // 20261104_0220; the detail is the admin's title + message
};

const BIG = new Set([
  "competition_winner",
  "entry_award",
  "entry_finalist",
  "potd_featured",
  "featured_artist",
  "certificate_issued",
]);

export function centreHeadline(type: string): Headline | null {
  if (!Object.prototype.hasOwnProperty.call(HEADLINES, type)) return null;
  return { key: `notifications.headline.${type}`, fallback: HEADLINES[type] };
}

export function isBigMoment(type: string): boolean {
  return BIG.has(type);
}
