import * as React from "react";
import { ChevronLeft, ChevronRight, ChevronDown, ChevronUp } from "lucide-react";
import { DayPicker, type ChevronProps } from "react-day-picker";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE LOOKS NOTHING LIKE THE SHADCN DEFAULT, 2026-08-16
 *
 * Upgraded react-day-picker v8.10.1 → v10.0.1 (PATCHWORK_AUDIT item 3).
 *
 * THE REASON FOR THE UPGRADE, not a version-chase: v8's peer range is
 * `^16.8 || ^17 || ^18`. This app is on React 19, so a clean `npm ci` died with
 * ERESOLVE and `.npmrc legacy-peer-deps=true` was the hold that kept CI alive.
 * v10 peers on `react: >=16.8.0`, which React 19 satisfies honestly, so the
 * hold can come out. v9 was the other candidate and was rejected: 9.14 drags in
 * date-fns-jalali AND a hijri converter as hard dependencies; v10 carries only
 * date-fns + @date-fns/tz. Fewer bytes shipped to a member on mobile data.
 *
 * THE TRAP THIS FILE EXISTS TO SURVIVE: v9 renamed EVERY `classNames` key and
 * changed the DOM those classes land on. A key that is not renamed does not
 * throw and does not fail typecheck — `classNames` is a partial record, so an
 * unknown key is simply ignored and that part of the calendar renders as an
 * unstyled browser default. Invisible to a unit test. Obvious in a photograph.
 * That is why the harness scenes `calendar-plain` and `calendar-dob` exist and
 * why both were captured before and after this change.
 *
 * THE STRUCTURAL CHANGE, and the one thing worth understanding here:
 *   v8  — the state class (`day_selected`, `day_today`, …) landed on the
 *         BUTTON, so `bg-primary` on it painted the button.
 *   v10 — the state class lands on the `<td>` CELL, and the button is a
 *         separate child element (`day_button`). Putting `bg-primary` on the
 *         cell paints a rectangle *behind* a transparent button, so the
 *         rounded corners and the hover state are both lost.
 * The fix is to reach through: `[&>button]:…` targets the button from the cell
 * that owns the state. That is why the state keys below read the way they do.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * v10 replaced v8's separate `IconLeft`/`IconRight` slots with ONE `Chevron`
 * component that receives an `orientation`. It is used by the nav buttons AND
 * by the month/year dropdowns, so all four directions must be handled — return
 * the wrong glyph for `down` and the dropdown caret points sideways.
 */
function Chevron({ orientation, className }: ChevronProps) {
  const Icon =
    orientation === "left"
      ? ChevronLeft
      : orientation === "right"
        ? ChevronRight
        : orientation === "up"
          ? ChevronUp
          : ChevronDown;
  return <Icon className={cn("h-4 w-4", className)} />;
}

/**
 * 44px. Not taste — iOS's minimum touch target and WCAG 2.5.5 AAA, the same
 * floor the screenshot sweep enforces everywhere else in this app. On v8 these
 * were 36px days and 28px nav buttons and the sweep reported all six of them.
 * 7 columns x 44 = 308px, which fits inside a 360px phone with the 3.5rem of
 * popover padding still to spare, so the grid does not need to scroll.
 */
const DAY_SIZE = "h-11 w-11";

function Calendar({ className, classNames, showOutsideDays = true, footer, ...props }: CalendarProps) {
  // Universal "OK" action: dispatches an Escape keydown that Radix's Popover/Dialog
  // dismiss layer catches, closing the surrounding date-picker popover after the user
  // has set the day/month/year. No-op for inline calendars not inside a dismissable layer.
  const okFooter = (
    <div className="mt-2 flex justify-end border-t border-border pt-2">
      <button
        type="button"
        onClick={(e) =>
          e.currentTarget.dispatchEvent(
            new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
          )
        }
        className={cn(buttonVariants({ variant: "default", size: "sm" }), "h-8 px-6")}
      >
        OK
      </button>
    </div>
  );
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      footer={footer ?? okFooter}
      className={cn("p-3 pointer-events-auto rounded-lg border border-border bg-popover mb-2", className)}
      classNames={{
        /* ── layout ─────────────────────────────────────────────────────── */
        // `relative` is load-bearing. In v8 the nav lived INSIDE the caption,
        // so `absolute left-1` on an arrow resolved against the caption row.
        // In v10 the <nav> is a SIBLING of the month, so with no positioned
        // ancestor both arrows resolved against the page and stacked in the
        // top-left corner — caught in the first post-upgrade screenshot, not
        // by typecheck and not by any unit test.
        months: "relative flex flex-col sm:flex-row gap-2",
        month: "space-y-2",

        /* v8 `caption`. Holds either the label or the dropdowns. */
        month_caption: "flex justify-center pt-1 relative items-center h-11",
        // Hidden because the month/year dropdowns carry the same information
        // and the nav arrows sit either side of it. Kept in the DOM for
        // screen readers rather than removed.
        caption_label: "text-sm font-semibold text-foreground hidden",

        /* v8 `caption_dropdowns`. */
        dropdowns: "flex items-center gap-2 justify-center",
        dropdown_root: "relative inline-flex items-center",
        months_dropdown: "relative inline-flex items-center",
        years_dropdown: "relative inline-flex items-center",
        // min-h-11 for the same tap-target reason as the days: on v8 these
        // rendered 26px tall and the sweep reported both of them.
        dropdown:
          "appearance-none bg-background border border-input rounded-md px-2 min-h-11 text-xs font-medium text-foreground cursor-pointer focus:outline-none focus:ring-1 focus:ring-ring",

        /* ── navigation ─────────────────────────────────────────────────── */
        // The whole bar is positioned once, over the caption row, and the two
        // arrows are pushed to its ends. Positioning each arrow individually
        // is what broke above; one positioned parent is the simpler shape and
        // survives the caption growing dropdowns.
        nav: "absolute inset-x-0 top-0 z-10 flex h-11 items-center justify-between",
        // v8 had ONE `nav_button` key plus two position keys. v10 has no shared
        // key at all, so the shared classes are written into both.
        button_previous: cn(
          buttonVariants({ variant: "ghost" }),
          "h-11 w-11 p-0 text-muted-foreground hover:text-foreground hover:bg-accent rounded-md",
        ),
        button_next: cn(
          buttonVariants({ variant: "ghost" }),
          "h-11 w-11 p-0 text-muted-foreground hover:text-foreground hover:bg-accent rounded-md",
        ),

        /* ── the grid ───────────────────────────────────────────────────── */
        month_grid: "w-full border-collapse",   // v8 `table`
        weekdays: "flex",                        // v8 `head_row`
        weekday: "text-muted-foreground rounded-md w-11 font-medium text-[0.75rem]", // v8 `head_cell`
        week: "flex w-full mt-0.5",              // v8 `row`

        /* v8 `cell` — the <td>. In v10 this is also where the state classes
           below land, which is why they are separate keys and not variants. */
        day: cn(
          "relative text-center text-sm p-0",
          DAY_SIZE,
          "focus-within:relative focus-within:z-20",
        ),

        /* v8 `day` — the <button> inside the cell. */
        day_button: cn(
          buttonVariants({ variant: "ghost" }),
          DAY_SIZE,
          "p-0 font-normal rounded-md hover:bg-accent",
        ),

        /* ── state, applied to the CELL; reach through to the button ───── */
        selected: cn(
          "[&>button]:bg-primary [&>button]:text-primary-foreground [&>button]:font-semibold",
          "[&>button:hover]:bg-primary [&>button:hover]:text-primary-foreground",
          "[&>button:focus]:bg-primary [&>button:focus]:text-primary-foreground",
        ),
        today: "[&>button]:bg-accent [&>button]:text-accent-foreground [&>button]:font-semibold",
        outside: "[&>button]:text-muted-foreground/40 [&>button]:opacity-100",
        disabled: "[&>button]:text-muted-foreground/30",
        range_start: "rounded-l-md bg-primary/10",
        range_middle: "bg-accent [&>button]:bg-transparent [&>button]:text-accent-foreground",
        range_end: "rounded-r-md bg-primary/10",
        hidden: "invisible",

        ...classNames,
      }}
      components={{ Chevron }}
      {...props}
    />
  );
}
Calendar.displayName = "Calendar";

export { Calendar };
