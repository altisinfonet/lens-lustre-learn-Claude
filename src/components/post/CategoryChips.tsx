/**
 * THE 1–5 CATEGORY PICKER. Shared by the web composer and the app composer.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE SELECTION RULE, EXACTLY AS THE OWNER SPECIFIED IT (2026-08-12)
 *
 *   0 selected      all 46 selectable · "Select 1–5" · 0/5 · Post DISABLED
 *   1–4 selected    all 46 selectable · n/5          · Post ENABLED
 *   5 selected      the other 41 DISABLED and non-responsive
 *                   the chosen 5 STAY TAPPABLE, to remove only
 *                   untapping one immediately re-enables all 46
 *
 * The last line is the one that matters. Owner, verbatim: *"if i need to see
 * ful, then untapp anyone, full categories will be seen then tap 5 but once tap
 * 5 - rest all will be grey no option to choose"*.
 *
 * If the chosen five went dead at the limit there would be no way back — your
 * first five choices would be permanent, with no path to change your mind. That
 * is why `disabled` below is `atLimit && !isSelected` and never plain `atLimit`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE COUNT IS ALWAYS ON SCREEN
 *
 * Owner: *"Don't let the user reach the final Post button and then discover:
 * 'You must select a category.'"* So the requirement is stated before it is
 * enforced — `n/5` is always visible, and the publish button is disabled with a
 * reason rather than erroring on submit.
 *
 * The database is NOT the gate here. Stage B2 turns on `POST-CAT-002` later, as
 * a backstop against old clients and direct API calls. Until then this is the
 * only thing enforcing the minimum, which is exactly why it is tested.
 */
import { useMemo } from "react";
import { useCategories } from "@/hooks/useCategories";
import { categoryIcon, categoryLabelKey, MIN_POST_CATEGORIES, MAX_POST_CATEGORIES } from "@/lib/categories";
import { useT } from "@/i18n/I18nContext";
import { cn } from "@/lib/utils";

export interface CategoryChipsProps {
  /** Currently chosen slugs, in the member's own order. */
  value: string[];
  onChange: (next: string[]) => void;
  /** Rendered above the chips. Hidden when the picker is inside a labelled row. */
  showHeading?: boolean;
  className?: string;
}

/**
 * Pure selection logic, exported so it can be tested without React.
 *
 * Returns the next selection, or the SAME ARRAY when the tap must be ignored —
 * so a caller can rely on identity to know nothing happened.
 */
export function toggleCategory(current: string[], slug: string, max = MAX_POST_CATEGORIES): string[] {
  const at = current.indexOf(slug);
  if (at !== -1) {
    // Removing is ALWAYS allowed, including at the limit. This is the escape
    // hatch that makes the limit survivable.
    const next = [...current];
    next.splice(at, 1);
    return next;
  }
  // Adding is refused at the limit. Identity is preserved so the caller can
  // tell a no-op from a change.
  if (current.length >= max) return current;
  return [...current, slug];
}

export default function CategoryChips({
  value,
  onChange,
  showHeading = true,
  className,
}: CategoryChipsProps) {
  const { data: categories = [] } = useCategories();
  const t = useT();

  const selected = useMemo(() => new Set(value), [value]);
  const atLimit = value.length >= MAX_POST_CATEGORIES;

  return (
    <div className={className}>
      {showHeading && (
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <h4 className="text-sm font-semibold">
            {t("post.categories.heading", "Categories")}
          </h4>
          {/* Always visible, so the rule is never a surprise at submit time. */}
          <span
            className={cn(
              "text-xs tabular-nums",
              atLimit ? "font-semibold text-primary" : "text-muted-foreground",
            )}
            aria-live="polite"
          >
            {value.length}/{MAX_POST_CATEGORIES}
          </span>
        </div>
      )}

      {showHeading && (
        <p className="mb-3 text-xs text-muted-foreground">
          {atLimit
            ? t("post.categories.limit", "Limit reached — remove one to choose another")
            : t("post.categories.hint", "Select 1 to 5")}
        </p>
      )}

      <div className="flex flex-wrap gap-2" role="group" aria-label="Categories">
        {categories.map((c) => {
          const isSelected = selected.has(c.slug);
          // ⚠ `atLimit && !isSelected` — NOT `atLimit`. See the header.
          const isDisabled = atLimit && !isSelected;
          const Icon = categoryIcon(c.icon_name);

          return (
            <button
              key={c.slug}
              type="button"
              aria-pressed={isSelected}
              disabled={isDisabled}
              onClick={() => {
                const next = toggleCategory(value, c.slug);
                // Identity check: a refused tap changes nothing, so don't
                // re-render or mark the draft dirty for it.
                if (next !== value) onChange(next);
              }}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-2 text-sm transition-colors",
                isSelected
                  ? "border-primary bg-primary text-primary-foreground font-medium"
                  : "border-border bg-muted/40 text-foreground hover:border-primary/50",
                isDisabled && "cursor-not-allowed opacity-40 hover:border-border",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              {/* The slug is a storage key and is never rendered. */}
              <span>{t(categoryLabelKey(c.slug), c.name)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Can this selection be published? The publish button reads this, not a count. */
export const canPublishCategories = (value: string[]): boolean =>
  value.length >= MIN_POST_CATEGORIES && value.length <= MAX_POST_CATEGORIES;
