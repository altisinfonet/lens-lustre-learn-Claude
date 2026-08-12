/**
 * THE CATEGORY STRIP — the horizontal filter across the top of the feed.
 *
 * Owner's design, 2026-08-12: icon above label, "All" first and selected by
 * default, all 46 categories in the SAME strip, scrolling horizontally.
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
 * "Portrait" means "show me portraits", not "add portraits to my filter". Tapping
 * the active chip returns to All rather than leaving the feed filtered by
 * something no longer highlighted.
 */
import { useRef } from "react";
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

export default function CategoryStrip({ value, onChange, className }: CategoryStripProps) {
  const { data: categories = [] } = useCategories();
  const t = useT();
  const scroller = useRef<HTMLDivElement>(null);

  const Chip = ({
    slug, label, Icon,
  }: { slug: string; label: string; Icon: ReturnType<typeof categoryIcon> }) => {
    const active = value === slug;
    return (
      <button
        type="button"
        onClick={() => onChange(active && slug !== ALL_FILTER ? ALL_FILTER : slug)}
        aria-pressed={active}
        className={cn(
          "flex shrink-0 flex-col items-center gap-1 px-3 py-2 transition-colors",
          "border-b-2",
          active
            ? "border-primary text-primary"
            : "border-transparent text-muted-foreground hover:text-foreground",
        )}
      >
        <Icon className="h-6 w-6" aria-hidden="true" />
        <span className="whitespace-nowrap text-xs font-medium">{label}</span>
      </button>
    );
  };

  return (
    <div
      ref={scroller}
      className={cn(
        // Horizontal scroll with the scrollbar hidden — the strip is swiped on a
        // phone and wheel-scrolled on desktop, and a visible bar under 46 chips
        // is noise.
        "flex items-stretch gap-1 overflow-x-auto border-b bg-card/60 px-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className,
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
  );
}
