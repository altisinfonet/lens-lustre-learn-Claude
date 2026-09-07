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
import ProfileLink from "@/components/ProfileLink";

const headingFont = { fontFamily: "var(--font-heading)" };
const bodyFont = { fontFamily: "var(--font-body)" };
const displayFont = { fontFamily: "var(--font-display)" };

const TodaysBirthdayStrip = () => {
  const { sidebarData } = useDashboardContext();

  // The admin switch that hides the sidebar card must hide this too, or the
  // owner would turn the section off and still see it on his phone.
  const enabled = sidebarData?.sections?.todays_birthday !== false;
  const people = sidebarData?.birthdays ?? [];
  /*
   * F-98c — THE HANDLE NOW TRAVELS WITH THE NAME.
   *
   * This read `useMemberHandles(...)`: a second, batched round trip that
   * fetched custom_url for members whose names had already arrived without it.
   * The auditor's ruling on 2026-09-05, and it is the right one — two
   * mechanisms delivering one handle is how the two drift apart, which is the
   * same argument this codebase already made about author_badges. The server
   * now carries custom_url in the row (dashboard-init/index.ts, and
   * get_todays_birthdays for the birthday rows), so the bridge is withdrawn
   * rather than stacked on top of the fix.
   */

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
            {/*
              F-103 — 36x36 (w-9 h-9) and the strip is xl:hidden, so it fails at
              every phone width and passes desktop-1280, which is exactly what
              the gate reported. The avatar stays 36px; the box around it is a
              real 44x44.

              ⚠ 2026-09-07 — THIS WAS `tap-44`, AND THE GATE COULD NEVER HAVE
              SEEN IT.

              `.tap-44` and `.tap-44-down` are both `::after` pseudo-elements
              (index.css:794-830). The UI gate measures
              `el.getBoundingClientRect()` on the ELEMENT
              (capture.mjs:409-412), and a pseudo-element is not in that box.
              So F-103's fix satisfied a thumb and was invisible to the
              instrument: the anchor still reports 36x36.

              Measured, not argued — `tap-44-down` was swapped in and the
              sweep re-run before this was written:

                tap-44        a.shrink-0.tap-44 36x36        FAIL
                tap-44-down   a.shrink-0.tap-44-down 36x36   FAIL
                h-11 w-11     a.shrink-0.grid 44x44          pass

              So the box is painted. That revisits the trade-off `.tap-44`'s
              own header records — padding "changes the box, so it changes
              flex/grid sizing" — and the gate is the tie-breaker: a hit region
              nothing can measure is not a hit region anyone can defend. The
              row grows 8px; the avatar does not change size.

              WHY IT ONLY FAILS NOW, and it is not a shrink: with no handle
              `ProfileLink` renders a <span>, and the gate only selects
              `button, a[href], [role=button], input, select, summary`. c96e9c6
              gave these rows a handle, so this became an <a href> — a control
              — and was measured for the first time. It did not get smaller; it
              became something the rule applies to.

              ⚠ OVERLAP RE-MEASURED, because two hit regions that intersect
              hand the shared strip to whichever paints later. The two avatars
              are stacked vertically, same `left`, and the row is `py-3` around
              a box that is now 44 rather than 36 — so the gap closes by 8px
              and has to be re-checked rather than inherited from the old note.
              Measured at 390px after this change: boxes 68px apart top-to-top,
              44 tall, so 24px of clear space, and `elementFromPoint` at the
              midpoint between them returns the row, not either anchor.
            */}
            <ProfileLink userId={u.id} handle={u.custom_url} className="shrink-0 grid h-11 w-11 place-items-center">
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
            </ProfileLink>
            <div className="flex-1 min-w-0">
              <UserIdentityBlock
                userId={u.id}
                name={u.full_name || "Photographer"}
                handle={u.custom_url}
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
