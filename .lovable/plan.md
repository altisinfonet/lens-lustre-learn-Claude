# Journal Article — Modern Editorial Redesign

Scope: `src/pages/JournalArticle.tsx` + `src/components/CommentsSection.tsx` (compact line). No backend, no data, no business logic changes. Purely presentational.

## Problems (verified from current file)
1. Body uses `prose-sm md:prose-base` → tiny on desktop (~14–16px). Hard to read.
2. No dedicated "About the Author" card — author shown only as a tiny meta line.
3. Content container is `max-w-3xl` with no editorial rhythm (no drop cap, no lead paragraph, no pull spacing).
4. Comments section header/layout heavy.
5. Cover + title + meta block visually unrelated to body.

## Design Direction — "Modern Editorial"
Reference register: NYT / The Verge / Medium long-read. Locked to existing tokens (`--font-display`, `--font-body`, `--font-heading`, `primary`, `border`, `muted-foreground`). No new colors.

### Desktop layout (≥ lg)
```
[ Full-bleed cover, 56vh, gradient fade ]
[ container max-w-6xl ]
  ┌─────────────────────────────┬──────────────┐
  │  Breadcrumb                 │              │
  │  Tags · Title (display 72) │  [ Sticky    │
  │  Lead/excerpt (22px serif) │   Author     │
  │  ── divider ──             │   Card +     │
  │  Body (19px, 1.75 leading) │   Share +    │
  │  First-letter drop cap     │   PDF +      │
  │  Inline images full-bleed  │   TOC of     │
  │                            │   tags ]     │
  │  Gallery (3-col masonry)   │              │
  │  ── Comments (compact) ──  │              │
  └─────────────────────────────┴──────────────┘
       main col: max-w-[720px]   aside: 280px sticky top-24
```

### Tablet / Mobile
- Single column, `max-w-2xl`.
- Author card collapses to inline horizontal card placed **after the lead paragraph** (between intro and main body) — answers user's "between the content or one side".
- Body 17px, 1.7 leading.
- Cover 38vh.

## Typography changes
| Element | Before | After (desktop / mobile) |
|---|---|---|
| H1 title | 2xl / 6xl light | display, 5xl / 7xl, tracking-tight |
| Lead (excerpt) | none | serif italic, 22px / 18px, muted-foreground |
| Body paragraphs | prose-sm/base (~14/16px) | **19px / 17px**, leading-[1.8], `--font-body` |
| Body H2/H3 in HTML | prose default | scoped `.prose-editorial` CSS, display font, generous top margin |
| Drop cap | none | first paragraph `::first-letter` 5xl, float left, primary color |
| Meta line | xs uppercase | unchanged size, slightly more spacing |

CSS additions go in `src/index.css` under a new `.prose-editorial` class (token-only — no raw colors).

## Author card
New component inline in JournalArticle (no new file unless needed):
- Avatar (40px) + name (display) + role/bio line (muted) + "View profile" link.
- Desktop: sticky right-rail card (border, p-5, rounded-sm).
- Mobile/tablet: horizontal card placed after lead paragraph, full width, `flex gap-4`.
- Uses existing `UserIdentityBlock` for name + verification; pulls existing `authorName` (no new query).

## Comments — one-line trigger
Change `CommentsSection` open-state header to a single compact row:
`💬 Comments (N) — Join the discussion ›` (button, 1 line, `text-sm`, border-top + py-3). Clicking expands the existing list (collapse/expand state added). Default collapsed. No data change.

## Files to edit
1. `src/pages/JournalArticle.tsx` — full layout rewrite (presentation only). Cover, two-column grid (lg), author card, lead paragraph (uses existing `excerpt`), drop cap wrapper, gallery spacing.
2. `src/index.css` — add `.prose-editorial` block (font sizes, leading, headings, blockquote, links, lists, images, drop cap).
3. `src/components/CommentsSection.tsx` — wrap content in collapsible; one-line trigger row.

## Out of scope (will NOT touch)
- Data fetching, RLS, queries, hooks.
- `FeaturedArtistPage` (different page).
- Journal list page.
- PDF generator, share logic — keep as-is, only move buttons into the sidebar/author card.
- No new dependencies.

## Verification
After edits: load `/journal/street-photography-ethics` at 1400px and at 390px via `browser--view_preview`, screenshot both, confirm: title large, body ≥19px desktop, author card visible, comments collapsed to one line.