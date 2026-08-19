/**
 * THE CATEGORY STRIP — the horizontal filter at the top of the feed.
 *
 * Owner's design, 2026-08-12: icon above label, "All" first and selected by
 * default, all 46 categories reachable from the SAME control.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * "ALL" IS NOT A CATEGORY.
 *
 * It is a system filter that applies no predicate at all, which is exactly why
 * the 205 posts created before this feature — and every post without categories
 * — still appear under it. It is never stored on a post and is not one of the
 * 46 rows in `public.categories`. Selecting it passes `null` to the feed RPC,
 * which is a different thing from passing an empty array.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ONE SELECTION AT A TIME.
 *
 * The feed RPC accepts an array and uses the `&&` overlap operator, so it could
 * take several at once. The strip deliberately sends one: a member tapping
 * "Portrait" means "show me portraits", not "add portraits to my filter".
 * Tapping the active chip returns to All rather than leaving the feed filtered
 * by something no longer highlighted.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠ EIGHT CHIPS FIT. FORTY-SIX EXIST. THAT GAP IS THE WHOLE PROBLEM.
 *
 * Owner, 2026-08-12: *"Categories scrolling after visible 46, who will do"* —
 * the first version was a bare `overflow-x-auto` row. On a phone that swipes
 * fine. On a desktop it is a trap: there is no touch, a mouse wheel scrolls the
 * PAGE not the row, and the 38 categories past "Nature" were effectively
 * unreachable. A filter nobody can reach is a filter that does not exist.
 *
 * So this control has three ways in, and every one of them reaches all 46:
 *
 *   1. swipe / drag           — phones and the Android app
 *   2. ‹ › arrows             — desktop only, shown only while there IS overflow
 *                               in that direction, so they never sit there dead
 *   3. "All categories" grid  — one tap, every category at once, no scrolling
 *
 * The grid is the real answer for someone hunting a specific category; the
 * arrows are for browsing. Do not remove the grid and leave only the arrows —
 * clicking ‹ › eleven times to reach "Wildlife Portrait" is the same defect
 * wearing a button.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, LayoutGrid, X } from "lucide-react";
import { useCategories } from "@/hooks/useCategories";
import { categoryIcon, categoryLabelKey, ALL_FILTER, ALL_ICON } from "@/lib/categories";
import { useT } from "@/i18n/I18nContext";
import { cn } from "@/lib/utils";

export interface CategoryStripProps {
  /** The chosen slug, or ALL_FILTER for no filter. */
  value: string;
  onChange: (next: string) => void;
  className?: string;
}

/** How far one press of ‹ or › travels. Roughly five chips. */
const NUDGE_PX = 320;

export default function CategoryStrip({ value, onChange, className }: CategoryStripProps) {
  const { data: categories = [] } = useCategories();
  const t = useT();
  const scroller = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);
  const [gridOpen, setGridOpen] = useState(false);

  /**
   * Which arrows are live. Recomputed on scroll, on resize, and whenever the
   * category list arrives — the list is fetched, so the first render has zero
   * chips and zero overflow, and an arrow state decided then would be wrong
   * forever.
   */
  const measure = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setCanLeft(el.scrollLeft > 1);
    // 1px of slack: fractional widths make scrollLeft land at max - 0.5.
    setCanRight(el.scrollLeft < max - 1);
  }, []);

  useEffect(() => {
    measure();
    const el = scroller.current;
    if (!el) return;
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure, categories.length]);

  const nudge = (dir: -1 | 1) => {
    scroller.current?.scrollBy({ left: dir * NUDGE_PX, behavior: "smooth" });
  };

  const pick = (slug: string, active: boolean) => {
    // Tapping the active chip clears the filter; tapping "All" again is a no-op.
    onChange(active && slug !== ALL_FILTER ? ALL_FILTER : slug);
    setGridOpen(false);
  };

  const Chip = ({
    slug, label, Icon,
  }: { slug: string; label: string; Icon: ReturnType<typeof categoryIcon> }) => {
    const active = value === slug;
    return (
      <button
        type="button"
        onClick={() => pick(slug, active)}
        aria-pressed={active}
        className={cn(
          "flex shrink-0 flex-col items-center gap-1 px-3 py-2 transition-colors",
          "border-b-2",
          // ⚠ AMBER, NOT `primary`. Owner's app mock, 2026-08-12: the selected
          // chip and its underline are orange. `text-primary` is the site's
          // blue and is what shipped first — it is not this control's colour.
          active
            ? "border-amber-500 text-amber-500"
            : "border-transparent text-muted-foreground hover:text-foreground",
        )}
      >
        <Icon className="h-6 w-6" aria-hidden="true" />
        <span className="whitespace-nowrap text-xs font-medium">{label}</span>
      </button>
    );
  };

  const Arrow = ({ dir, show }: { dir: -1 | 1; show: boolean }) => (
    <button
      type="button"
      onClick={() => nudge(dir)}
      aria-label={dir === -1 ? t("common.previous", "Previous") : t("common.next", "Next")}
      // `hidden md:flex` — a phone swipes, and an arrow there is a chip's worth
      // of stolen width. `invisible` rather than unmounted at the ends so the
      // row does not jump sideways as the last chip scrolls into view.
      className={cn(
        "absolute top-0 bottom-0 z-10 hidden w-8 items-center justify-center md:flex",
        "bg-gradient-to-r from-card via-card/90 to-transparent text-muted-foreground",
        "hover:text-foreground",
        dir === -1 ? "left-0" : "right-8 rotate-180",
        !show && "pointer-events-none opacity-0",
      )}
    >
      <ChevronLeft className="h-5 w-5" aria-hidden="true" />
    </button>
  );

  return (
    <div className={cn("relative border-b bg-card/60", className)}>
      <div
        ref={scroller}
        onScroll={measure}
        className={cn(
          // Horizontal scroll with the scrollbar hidden — the strip is swiped on
          // a phone and a visible bar under 46 chips is noise. Desktop reaches
          // the rest through the arrows and the grid below.
          "flex items-stretch gap-1 overflow-x-auto px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          /**
           * Room for the ‹ › and grid buttons so a chip never hides under one.
           *
           * ⚠ `pr-11` IS NOT `md:`, AND THAT WAS THE BUG. The intent above was
           * right from the start; it was only ever applied from `md` up, while
           * the "All categories" button is `absolute right-0 w-9` at EVERY
           * width. So on a phone the reserved space did not exist and the
           * button sat directly on top of the chips.
           *
           * Measured on `screen-feed` at 390 before the fix: the "Architecture"
           * chip showed 43x62px, and a tap at the centre of what was visible
           * (x=365) hit the grid button — so the chip opened All categories
           * instead of filtering the feed. Found by the reachability gate on a
           * screen nobody was looking at, which is what that gate is for.
           *
           * AND IT IS A MARGIN, NOT PADDING — the first attempt at this fix
           * used `pr-11` and the gate stayed RED, correctly. Padding sits
           * INSIDE the scrolling content, so it only guarantees the LAST chip
           * clears the button once you have scrolled to the end; every other
           * chip still slides underneath on the way past. `mr-9` makes the
           * scroll viewport itself stop where the button starts, so no chip is
           * ever rendered under it at any scroll position. Flush against the
           * button's own `border-l`, which is the divider.
           *
           * The ARROWS stay `md:` because they are `hidden md:flex` —
           * genuinely desktop-only, so reserving width for them on a phone
           * would steal a chip's worth for nothing.
           */
          "mr-9 md:mr-0 md:pl-9 md:pr-20",
        )}
        role="tablist"
        aria-label={t("feed.categories", "Categories")}
      >
        {/* Always first, always present, default selection. */}
        <Chip slug={ALL_FILTER} label={t("cat.all", "All")} Icon={ALL_ICON} />
        {categories.map((c) => (
          <Chip
            key={c.slug}
            slug={c.slug}
            // The slug is a storage key and is never rendered.
            label={t(categoryLabelKey(c.slug), c.name)}
            Icon={categoryIcon(c.icon_name)}
          />
        ))}
      </div>

      <Arrow dir={-1} show={canLeft} />
      <Arrow dir={1} show={canRight} />

      {/* The way out of scrolling entirely: every category, one screen. */}
      <button
        type="button"
        onClick={() => setGridOpen(true)}
        aria-label={t("feed.allCategories", "All categories")}
        className={cn(
          "absolute right-0 top-0 bottom-0 z-10 flex w-9 items-center justify-center",
          "border-l border-border bg-card text-muted-foreground hover:text-foreground",
        )}
      >
        <LayoutGrid className="h-4 w-4" aria-hidden="true" />
      </button>

      {gridOpen && (
        <>
          {/* ⚠ THIS SHEET MUST OUTRANK THE BOTTOM NAV, AND CLEAR IT.
              MobileBottomNav is `fixed bottom-0 z-50` and 48px tall. This sheet
              was ALSO `bottom-0 z-50`, so on a phone the nav painted over its
              first row of chips — the owner's screenshot shows the camera/"All"
              chip sliced in half by the ribbon.

              Two separate defects, two separate fixes, both needed:
                • z-[60] / z-[55] — win the stacking contest against the nav.
                • pb-20 below md   — 48px of nav + breathing room, so the LAST
                                     row of chips is reachable, not just visible.
              Desktop is unaffected: the sheet is centred there and never meets
              the nav, which is `lg:hidden`. */}
          <div
            className="fixed inset-0 z-[55] bg-black/60"
            onClick={() => setGridOpen(false)}
            aria-hidden="true"
          />
          <div
            role="dialog"
            aria-label={t("feed.allCategories", "All categories")}
            className={cn(
              "fixed inset-x-0 bottom-0 z-[60] max-h-[75dvh] overflow-y-auto rounded-t-2xl border-t border-border bg-card p-4 pb-20",
              "md:inset-x-auto md:bottom-auto md:left-1/2 md:top-1/2 md:w-[640px] md:max-w-[92vw]",
              "md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl md:border md:pb-4",
            )}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold">
                {t("feed.allCategories", "All categories")}
              </h2>
              <button
                type="button"
                onClick={() => setGridOpen(false)}
                aria-label={t("common.close", "Close")}
                className="rounded-full p-1.5 hover:bg-muted"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
              {[
                { slug: ALL_FILTER, label: t("cat.all", "All"), Icon: ALL_ICON },
                ...categories.map((c) => ({
                  slug: c.slug,
                  label: t(categoryLabelKey(c.slug), c.name),
                  Icon: categoryIcon(c.icon_name),
                })),
              ].map(({ slug, label, Icon }) => {
                const active = value === slug;
                return (
                  <button
                    key={slug}
                    type="button"
                    onClick={() => pick(slug, active)}
                    aria-pressed={active}
                    className={cn(
                      "flex flex-col items-center gap-1.5 rounded-lg border px-2 py-3 text-center transition-colors",
                      active
                        ? "border-amber-500 bg-amber-500/10 text-amber-500"
                        : "border-border text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                    )}
                  >
                    <Icon className="h-6 w-6" aria-hidden="true" />
                    <span className="text-xs font-medium leading-tight">{label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
