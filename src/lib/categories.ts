/**
 * The photography category taxonomy — client side.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * THE DATABASE IS THE SOURCE OF TRUTH. THIS FILE IS NOT.
 *
 * Owner, 2026-08-12: "The `categories` table must remain the single source of
 * truth for category name, slug, icon, sort order, and active status."
 *
 * So the slugs, the display names, the order and the active flag all come from
 * `public.categories` at runtime, through `useCategories()`. Adding a category,
 * renaming one, reordering the strip or hiding one are all admin actions in the
 * database — none of them needs a deploy.
 *
 * What lives here is the ONE thing a database row cannot hold: the mapping from
 * an icon NAME to a React component. `icon_name` in the table is a lucide-react
 * export name; this file is the allow-list that turns it into something React
 * can render.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY AN ALLOW-LIST AND NOT `(LucideIcons as any)[name]`
 *
 * Because that would let a row in the database decide which of ~1,500 exports
 * gets imported, which defeats tree-shaking and pulls the entire icon library
 * into the bundle. The named imports below are what Vite can actually see.
 *
 * An `icon_name` that is not in this map falls back to `Camera` rather than
 * crashing the strip. If a new category is added in the database with an icon
 * that is not listed here, `categoryTaxonomy.test.ts` fails — that is what
 * stops the two lists drifting apart.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SLUGS ARE STORAGE KEYS. NEVER DISPLAY THEM.
 *
 * `black-and-white` is what sits in `posts.categories` and in
 * `profiles.photography_interests`. What a member sees is the translated name
 * (`cat.black-and-white`), falling back to `categories.name`. A slug is never
 * rendered, and a display name is never stored.
 */
import {
  Baby, Bird, Briefcase, Building, Building2, CalendarDays, Camera, Car,
  Coffee, Contrast, Dog, Factory, FileText, Film, FlaskConical, Flower2,
  Footprints, HandHeart, Heart, Home, Lamp, Landmark, Lightbulb, Luggage,
  Medal, Microscope, Minus, Moon, Mountain, Newspaper, Package, Palette,
  PawPrint, Plane, PlaneTakeoff, Radio, Shapes, Shirt, Smartphone, Stars,
  Timer, Trees, Trophy, User, Utensils, Wand2, Waves,
  type LucideIcon,
} from "lucide-react";

/** A row of `public.categories`, exactly as the table defines it. */
export interface Category {
  slug: string;
  name: string;
  icon_name: string;
  sort_order: number;
  is_active: boolean;
}

/**
 * "All" is NOT one of the 46. It is a system filter that applies no predicate
 * at all, which is precisely why posts created before this feature — and any
 * post without categories — still appear under it.
 *
 * Exported as a constant so no surface invents its own spelling.
 */
export const ALL_FILTER = "all" as const;

/**
 * Every lucide name the taxonomy is allowed to reference.
 *
 * Two of these are honest compromises, both because lucide-react 0.462 simply
 * has no such glyph — checked against the package, not assumed:
 *   • `aerial` uses Plane, because there is no Drone icon (aviation gets PlaneTakeoff)
 *   • `equine` uses Medal, because there is no Horse icon
 * Both are one database UPDATE away from changing, and the label always sits
 * beside the icon.
 */
export const CATEGORY_ICONS: Readonly<Record<string, LucideIcon>> = {
  Baby, Bird, Briefcase, Building, Building2, CalendarDays, Camera, Car,
  Coffee, Contrast, Dog, Factory, FileText, Film, FlaskConical, Flower2,
  Footprints, HandHeart, Heart, Home, Lamp, Landmark, Lightbulb, Luggage,
  Medal, Microscope, Minus, Moon, Mountain, Newspaper, Package, Palette,
  PawPrint, Plane, PlaneTakeoff, Radio, Shapes, Shirt, Smartphone, Stars,
  Timer, Trees, Trophy, User, Utensils, Wand2, Waves,
};

/** The icon for the "All" chip. Deliberately separate — All is not a category. */
export const ALL_ICON: LucideIcon = Camera;

/**
 * Resolve a database `icon_name` to a component.
 *
 * Falls back to `Camera` instead of throwing: a mistyped icon name in one row
 * should cost that chip its picture, not take the whole strip down with it.
 */
export const categoryIcon = (iconName: string | null | undefined): LucideIcon =>
  (iconName && CATEGORY_ICONS[iconName]) || Camera;

/**
 * The i18n key for a category's display name.
 *
 * Falls back to `categories.name` from the database, so a category added by an
 * admin before its translation exists still reads correctly in English rather
 * than showing a raw key.
 */
export const categoryLabelKey = (slug: string): string => `cat.${slug}`;

/** 1–5 categories per post. The database enforces this too — see Phase B. */
export const MIN_POST_CATEGORIES = 1;
export const MAX_POST_CATEGORIES = 5;
