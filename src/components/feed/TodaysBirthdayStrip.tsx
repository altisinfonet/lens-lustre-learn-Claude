/**
 * TODAY'S BIRTHDAY — the half that phones never had.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OWNER REPORT, 2026-08-04:
 *
 *   "Web — Today's Birthday Exists, but desktop only and it misses 28 of 68
 *    members. Only fix this error."
 *
 * Two defects, and only one of them was fixed at the time:
 *
 *   ✅ THE MISSING 28. `dashboard-init` used an UNORDERED `LIMIT 50` over the
 *      member table, so 28 of the 68 members with a date of birth fell outside
 *      the window and were invisible on their own birthday. Replaced by
 *      `get_todays_birthdays()`, which has no row limit and is privacy-aware.
 *      Live on production since 2026-08-05 (dashboard-init v20).
 *
 *   ❌ DESKTOP ONLY. `Layout.tsx` wraps the left sidebar in `hidden xl:block`.
 *      Below 1280px it is not hidden — it is NOT RENDERED AT ALL. So on every
 *      phone, every tablet, and inside the Android app, Today's Birthday did
 *      not exist. That is this file.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SEPARATE COMPONENT RATHER THAN UN-HIDING THE SIDEBAR
 *
 * The left sidebar also carries competitions, courses, journal, winners and the
 * voting lightbox. Showing all of that above the feed on a 390px screen would
 * bury the posts. Only the birthday needed to reach phones, so only the
 * birthday crosses over.
 *
 * `xl:hidden` is the exact complement of the sidebar's `hidden xl:block`, so at
 * no width does a member see it twice.
 *
 * NO NEW NETWORK CALL: the rows come from `useDashboardContext()` — the same
 * single `dashboard-init` response the sidebar already reads. Adding a query
 * here would have meant a second round trip on every feed open.
 *
 * DIFFERENCE FROM THE SIDEBAR, DELIBERATE: the sidebar prints "No birthdays
 * today" when the list is empty, because it occupies a fixed slot in a column.
 * Above the feed that would be a permanent empty box on the most valuable
 * screen real estate in the product — on most days nobody has a birthday. So
 * this renders NOTHING unless there is someone to celebrate.
 */
import { Link } from "react-router-dom";
import { PartyPopper } from "lucide-react";
import { useDashboardContext } from "@/hooks/core/DashboardContext";
import UserIdentityBlock from "@/components/UserIdentityBlock";

const headingFont = { fontFamily: "var(--font-heading)" };
const bodyFont = { fontFamily: "var(--font-body)" };
const displayFont = { fontFamily: "var(--font-display)" };

const TodaysBirthdayStrip = () => {
  const { sidebarData } = useDashboardContext();

  // The admin switch that hides the sidebar card must hide this too, or the
  // owner would turn the section off and still see it on his phone.
  const enabled = sidebarData?.sections?.todays_birthday !== false;
  const people = sidebarData?.birthdays ?? [];

  if (!enabled || people.length === 0) return null;

  return (
    <div
      className="xl:hidden mb-4 border border-border bg-card/50 rounded-sm"
      data-testid="todays-birthday-strip"
    >
      <div className="px-4 py-3 border-b border-border">
        <span
          className="text-[9px] tracking-[0.3em] uppercase text-primary flex items-center gap-1.5"
          style={headingFont}
        >
          <PartyPopper className="h-3 w-3" />
          Today's Birthday
        </span>
      </div>

      <div className="divide-y divide-border">
        {people.map((u: any) => (
          <div key={u.id} className="flex items-center gap-3 px-4 py-3">
            <Link to={`/profile/${u.id}`} className="shrink-0">
              {u.avatar_url ? (
                <img
                  referrerPolicy="no-referrer"
                  loading="lazy"
                  decoding="async"
                  src={u.avatar_url}
                  alt=""
                  className="w-9 h-9 rounded-full object-cover"
                />
              ) : (
                <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center">
                  <span className="text-[11px] text-primary" style={displayFont}>
                    {(u.full_name || "?")[0]?.toUpperCase()}
                  </span>
                </div>
              )}
            </Link>
            <div className="flex-1 min-w-0">
              <UserIdentityBlock
                userId={u.id}
                name={u.full_name || "Photographer"}
                linkTo={`/profile/${u.id}`}
                nameClassName="text-sm font-medium truncate hover:text-primary transition-colors"
              />
              <span className="text-[10px] text-muted-foreground" style={bodyFont}>
                🎂 Happy Birthday!
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default TodaysBirthdayStrip;
