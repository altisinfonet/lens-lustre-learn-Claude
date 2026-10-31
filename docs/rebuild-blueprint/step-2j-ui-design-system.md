# Step 2J — UI / Design System Blueprint

> **Forensic inventory of the design tokens, component library, layout primitives, animation system, and CSS conventions.** Every claim is line-cited. Items not directly verified are flagged `NOT VERIFIED`.

---

## 1. Theme Philosophy

**Core direction (from memory `style/aesthetic-and-layout-structure` + Core rules):**
- **High-density minimal dark editorial.**
- 3-column shell with a **fixed 590px center column** (Facebook-classic feed proportions).
- `bg-secondary-foreground` is the canonical input-surface token (deliberate inversion of light-mode neutrality).
- **Brand**: 50mm Retina World — dark editorial photography community.

Light mode is the default at `:root`; dark mode flips via `.dark` class on `<html>` (`darkMode: ["class"]` — `tailwind.config.ts` L4). Theme switching is wired through `useTheme.tsx` + `next-themes` style provider.

---

## 2. Design Tokens — `src/index.css`

### 2.1 Semantic colour tokens (HSL only, no raw hex)

| Token (light → dark)            | Light HSL          | Dark HSL          | Usage |
|---------------------------------|--------------------|-------------------|-------|
| `--background` / `--foreground` | `209 40% 96%` / `222 47% 11%` | `222 47% 11%` / `210 40% 98%` | Page surface |
| `--card` / `--card-foreground`  | `210 40% 98%` / `222 47% 11%` | `217 32% 17%` / `210 40% 98%` | Card surface |
| `--popover`                     | `214 31% 91%`      | `215 24% 26%`     | Floating menus |
| `--primary`                     | `200 98% 39%` (FB blue) | `198 93% 59%` | Brand action |
| `--secondary`                   | `215 24% 26%`      | `212 26% 83%`     | Buttons, surfaces |
| `--muted` / `--muted-foreground`| `215 20% 65%` / `222 47% 11%` | `215 16% 46%` / `210 40% 98%` | Subtle |
| `--accent`                      | `210 40% 98%`      | `228 84% 4%`      | Hover surfaces |
| `--destructive`                 | `0 72% 50%`        | `0 84% 60%`       | Danger actions |
| `--border` / `--input`          | `212 26% 83%`      | `215 19% 34%`     | Strokes |
| `--ring`                        | `200 98% 39%`      | `198 93% 59%`     | Focus ring |
| `--radius`                      | `0.5rem`           | `0.5rem`          | Border radius base |

**Sidebar tokens** (`--sidebar-background`, `--sidebar-primary`, `--sidebar-accent`, `--sidebar-border`, `--sidebar-ring` + foreground variants) — separate scale so sidebar can diverge from page surface (light: pure white; dark: `220 8% 15%`).

### 2.2 Domain-specific token scales

**Judge score spectrum (0–10)** — `src/index.css` L44–L55:
```css
--score-0:  0 72% 45%;   /* deep red */
--score-1:  0 65% 50%;
--score-2: 25 90% 50%;   /* orange */
…
--score-7: 142 70% 45%;  /* pass threshold (green) */
--score-10: 174 65% 36%; /* teal */
```
Each criterion slider in the judge panel maps `value → hsl(var(--score-{n}))`. Memory: `judging/criteria-and-scoring-standards`.

**Judge progress ring** — `--progress-marked`, `--progress-remaining` (separate light/dark values, L57–L59 + L160–L162).

**Scroll section backgrounds** — `--scroll-bg-1` … `--scroll-bg-5` (L70–L75 light, L139–L144 dark) for landing-page section alternation.

**Charts** — `--chart-1` … `--chart-5` for Recharts (L80–L84 light, L145–L149 dark).

**Shadows** — full scale `--shadow-2xs` … `--shadow-2xl` defined per-mode (L89–L96 light, L151–L158 dark). Surfaced via Tailwind `shadow-{xs|sm|md|lg|xl|2xl}` (`tailwind.config.ts` L158–L166).

### 2.3 Typography tokens

| Token            | Value                                                     |
|------------------|-----------------------------------------------------------|
| `--font-display` | `Helvetica, Arial, sans-serif`                            |
| `--font-heading` | `Helvetica, Arial, sans-serif`                            |
| `--font-body`    | `Helvetica, Arial, sans-serif`                            |
| `--font-sans`    | `Inter, ui-sans-serif, system-ui, …`                      |
| `--font-serif`   | `Lora, ui-serif, Georgia, …`                              |
| `--font-mono`    | `Space Mono, ui-monospace, SFMono-Regular, …`             |

**Live mismatch noted**: `--font-display/heading/body` resolve to Helvetica even though `Inter`, `Lora`, `Space Mono` are imported (`index.css` L1–L3) and registered in Tailwind's `fontFamily.{sans,serif,mono}`. Body uses `var(--font-body)` (L203) → Helvetica. Components opting into `font-sans` etc. get the Tailwind stack instead. Risk flagged in §9.

**Heading rules** (`index.css` L214–L240):
- `h1`: 700 weight, `letter-spacing: -0.03em`, line-height 1.2
- `h2`: 700 weight, `-0.02em`
- `h3`: 600 weight, `-0.01em`
- `h4–h6`: 600 weight, `-0.005em`
- Small / labels / `text-xs` / `text-[10px]` / `text-[11px]` → `letter-spacing: 0.02em` (improves micro-type legibility on dark)

Body baseline (L201–L211): `font-size: 14px`, `line-height: 1.34`, antialiased, transition on theme switch.

### 2.4 Spacing & radius
- `--spacing: 0.25rem` — Tailwind default 4px scale (no override).
- `--radius: 0.5rem` (8px). Tailwind exposes `rounded-lg` = `var(--radius)`, `rounded-md` = `calc(var(--radius) - 2px)`, `rounded-sm` = `calc(var(--radius) - 4px)`.
- `--tracking-normal: 0em`.

---

## 3. Animation System

### 3.1 Keyframes (`tailwind.config.ts` L72–L111)

| Animation            | Use case                                      | Easing |
|----------------------|-----------------------------------------------|--------|
| `accordion-down/up`  | Radix Accordion content                       | ease-out 0.2s |
| `photo-reveal`       | Image fade-in with blur removal               | cubic-bezier(0.16,1,0.3,1) 0.5s |
| `badge-pop`          | Verified-user / award-badge entrance          | spring (0.34,1.56,0.64,1) 0.45s |
| `ripple`             | Touch / click feedback                        | ease-out 0.55s |
| `shimmer`            | Skeleton loading                              | ease-in-out 2.4s infinite |
| `glow-pulse`         | CTA attention pulse                           | ease-out 0.9s |
| `slide-in-from-right/left` | Drawer / sheet entrance                 | cubic-bezier(0.16,1,0.3,1) 0.32s |

### 3.2 Custom CSS-only effects (`index.css`)
- **Ken Burns** (L247–L250): slow 1× → 1.08× scale + drift for hero images.
- **Neon multi-color border** (L354–L407): `@property --neon-angle` animated `conic-gradient` glow used in:
  - `VirtualizedPhotoGrid` PhotoCell (hover-only, `group-hover`)
  - `CinemaFullView` active image (always-on soft pulse via `.neon-border-active`)
  - Tokens-only — no hardcoded colors. Respects `prefers-reduced-motion` (L405–L407).

### 3.3 Animation library policy
**Memory: design system + Core rules** — `framer-motion` is the project's chosen animation library for component-level motion. CSS keyframes above are reserved for global effects that should not pay React's runtime cost.

---

## 4. Component Library

### 4.1 shadcn/ui primitives (49 files in `src/components/ui/`)

Full inventory:
```
accordion, alert-dialog, alert, aspect-ratio, avatar, badge, breadcrumb,
button, calendar, card, carousel, chart, checkbox, collapsible, command,
context-menu, dialog, drawer, dropdown-menu, form, hover-card, input-otp,
input, label, menubar, navigation-menu, pagination, popover, progress,
radio-group, resizable, scroll-area, select, separator, sheet, sidebar,
skeleton, slider, sonner, switch, table, tabs, textarea, toast, toaster,
toggle-group, toggle, tooltip
```

All are stock shadcn (Radix-based) with the project's token-driven Tailwind classes. No bespoke variants beyond defaults, with one exception (`button.tsx` examined in §4.2).

### 4.2 Button variant matrix (`src/components/ui/button.tsx`)

```ts
variant: {
  default:      "bg-primary text-primary-foreground hover:bg-primary/90",
  destructive:  "bg-destructive text-destructive-foreground hover:bg-destructive/90",
  outline:      "border border-input bg-background hover:bg-accent hover:text-accent-foreground",
  secondary:    "bg-secondary text-secondary-foreground hover:bg-secondary/80",
  ghost:        "hover:bg-accent hover:text-accent-foreground",
  link:         "text-primary underline-offset-4 hover:underline",
}
size: { default: "h-10 px-4 py-2", sm: "h-9 px-3", lg: "h-11 px-8", icon: "h-10 w-10" }
```

Single base ring config (`focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`). Slot pattern via `@radix-ui/react-slot` enables `asChild` for `<NavLink>` composition. `[&_svg]:size-4` enforces 16px lucide icons.

### 4.3 Domain components (271 total `.tsx` files in `src/components/`)

| Subdirectory       | File count | Purpose                                              |
|--------------------|-----------:|------------------------------------------------------|
| `ui/`              | 49         | shadcn primitives                                    |
| `admin/`           | 90         | Admin panel screens, audit widgets, gift credits     |
| `judge/`           | 30         | Cinema mode, score sliders, history tab, conflict badges |
| `profile/`         | 9          | Edit profile sections, public profile widgets         |
| `post/`            | 6          | Wall post composer, attachment previews              |
| `gallery/`         | 5          | Photo Hub views, lightboxes                          |
| `competition/`     | 4          | Competition detail blocks                            |
| `course/`          | 4          | Course player & progress UI                          |
| `auth/`            | 1          | Auth-page chrome                                     |
| `chat/`            | 1          | Ask-Anything chat panel                              |
| `discover/`        | 1          | Discover landing                                     |
| `sidebar/`         | 1          | Sidebar pre-seeded widgets                           |
| _root_             | 70         | Cross-cutting (Layout, Navbar, NotificationBell, AutoBadge, AutoRole, Lightbox, OptimizedImage, OnboardingModal, AnnouncementBar, AdPlacement, EngagementFooter, FileUploadDropZone, EntryCard, …) |

**Component-density highlights:**
- `admin/` is the largest cluster (90 files) — every audit widget (Notification Health, Awards Integrity, Wallet Reconciliation, Judge Privacy, Per-Photo Drift) renders here. Memory: `admin/governance-and-rbac`, `admin/judge-ui-vs-db-gate-audit`.
- `judge/` (30 files) houses the Cinema Mode UI, mobile bottom-nav badges, conflict highlighting, criteria sliders, and history tab. Memories: `style/judging-panel-ui-ux`, `style/mobile-judging-experience`, `judging/evaluation-experience`.

### 4.4 Cross-cutting "auto" components

| Component             | Purpose                                                       |
|-----------------------|---------------------------------------------------------------|
| `AutoBadge`           | Drop-in next to any username → fetches verified badges via `useProfileMap` cache. `React.memo` wrapped. |
| `AutoRole`            | Drop-in next to any username → role pills with own 60s TTL cache + Realtime sync (see Step 2I §5). |
| `OptimizedImage`      | LQIP + WebP delivery; respects `useProgressiveImage`.          |
| `AvatarCompletionRing`| Profile-completion circular progress around avatar.           |
| `BrandLoader`         | App-wide loading state (uses 50mm logo).                       |
| `FileUploadDropZone`  | The **only** sanctioned upload UI (memory: `features/file-management`); routes through security scanner. |
| `MentionInput`        | @-mention textarea with profile autocomplete.                  |
| `Lightbox` / `CompetitionLightbox` / `JuryImageViewer` | Modal image viewers with watermark/EXIF overlays. |

---

## 5. Layout Primitives

### 5.1 Container override (`index.css` L259–L265)
```css
.container {
  width: 90% !important;
  margin: 0 auto !important;
  max-width: 2000px !important;
  padding-left: 0 !important;
  padding-right: 0 !important;
}
```
Overrides Tailwind's default `.container` to **90% width / 2000px cap, zero gutter**. Ensures full-bleed editorial layout. Memory: `style/aesthetic-and-layout-structure`.

### 5.2 Three-column shell
- Layout root: `src/components/Layout.tsx`
- Left sidebar: `FeedLeftSidebar.tsx` (pre-seeded from `dashboard-init`)
- Center: route `<Outlet />` — fixed 590px on feed routes (Core memory)
- Right sidebar: `FeedRightSidebar.tsx`
- Mobile: `MobileBottomNav.tsx` + `MobileProfileSheet.tsx` collapse the side rails into a bottom-tab pattern.

### 5.3 Viewport / safe-area utilities
- `.h-screen-safe` / `min-h-screen-safe` (`tailwind.config.ts` L66–L71): uses `100dvh` for true viewport on mobile browsers with chrome.
- `.safe-area-bottom` (`index.css` L343–L345): `env(safe-area-inset-bottom)` for notched devices (iPhone bottom-nav clearance).
- `@media (display-mode: standalone)` → `.pwa-hide` (L348–L352): toggles browser-only chrome off when installed as PWA.

### 5.4 Auth viewport-lock
Memory: `auth/layout-and-design` — auth pages use `h-screen` (not `min-h-screen`) so they never scroll; this is enforced as a single-page constraint.

---

## 6. Cross-browser & accessibility CSS

| Concern                          | Source                                                           |
|----------------------------------|------------------------------------------------------------------|
| Tap-highlight removal (mobile)   | `* { -webkit-tap-highlight-color: transparent; }` L167           |
| Custom scrollbar (3px primary/18%)| L168–L188                                                        |
| `.scrollbar-themed` (1–2px hover-grow) | L318–L339 utility                                          |
| `.scrollbar-hide`                | L311–L317 utility                                                |
| Native `<select>` dark fix       | L191–L199                                                        |
| Backdrop-blur fallback           | `@supports not (backdrop-filter)` → 95% bg fallback L268–L273    |
| Line-clamp Webkit support        | L276–L282                                                        |
| Safari flex-gap polyfill         | `@supports not (gap: 1px)` margin fallback L285–L292             |
| Touch-device hover suppression   | `@media (hover: none)` cancels group-hover transforms L295–L307  |
| Reduced-motion neon              | L405–L407                                                        |

---

## 7. Specialised UI memories (cross-reference)

| Memory                                     | UI consequence                                                 |
|--------------------------------------------|----------------------------------------------------------------|
| `style/submission-card-layout`             | All submission cards locked to 1:1 aspect, 1-line truncation   |
| `style/admin-panel-ui`                     | High-density tables (compact row sizing across admin)          |
| `style/mobile-app-experience`              | Bottom-nav constraint + high-contrast tuning on mobile         |
| `style/mobile-judging-experience`          | Bottom-nav score badges, large touch targets                   |
| `features/profile-stories-highlights`      | Accent → amber gradient ring on stories                        |
| `features/competition/visuals-and-lifecycle` | Round-color spectrum (R1–R4) tied to score tokens            |
| `features/seo-management-visuals`          | 1200×630 OG-image overrides + fallbacks                        |
| `architecture/social-rendering-unification`| Dynamic aspect ratios + physics gestures in feed media         |
| `auth/layout-and-design`                   | `h-screen`-locked auth, no-scroll                              |

---

## 8. Token-discipline rules (enforced)

**From the Lovable design-system prompt (Core):**

1. **Never write raw colour classes** (`text-white`, `bg-black`, `bg-blue-500`) in components — always use semantic tokens (`text-foreground`, `bg-card`, `bg-primary`).
2. **All colours in HSL** in `index.css` and `tailwind.config.ts` (verified — every token defined as `H S% L%` triple).
3. **All new colours must be added to `tailwind.config.ts`** so `bg-{token}` / `text-{token}` work.
4. **Both light and dark modes must be defined** for every token (verified for the standard scale; some domain scales like `--scroll-bg-*` are dual-defined L70 + L139).
5. **Use shadcn variants via cva()** — never inline ad-hoc class strings for repeated patterns. Pattern shown in `button.tsx`.

**Not enforced by lint** — convention only. Drift risk flagged in §9.

---

## 9. Risks / Tech-debt observations

> Surfaced for Step 3 (Risk register).

1. **Font token mismatch** — `--font-display/heading/body` all resolve to `Helvetica` even though Inter/Lora/Space Mono are imported and registered. Components using `var(--font-body)` get Helvetica; components using Tailwind's `font-sans` get Inter. UI inconsistency latent.
2. **`!important` cascade in `.container`** — five `!important` declarations (L259–L265). Future overrides become painful; any component needing a different gutter must use a non-container wrapper.
3. **No lint rule blocks raw colour classes** — design rule is convention-only. A new contributor could slip `bg-blue-500` past review.
4. **No lint rule pins shadcn primitives** — `src/components/ui/*` files are checked in (not from a registry), so accidental edits to `button.tsx` won't be flagged as "diverged from upstream".
5. **`!important` on `.scrollbar-themed` is absent but Webkit width transitions don't animate** — width changes between `1px` and `2px` are repaints, not transitions. Cosmetic.
6. **Three font families loaded over network** (`fonts.googleapis.com` Inter, Lora, Space Mono — L1–L3) but `--font-body` doesn't use any of them. Wasted bandwidth on first paint.
7. **`darkMode: ["class"]` but `.dark` is the user-facing default** in the wild (per memory `Theme: dark editorial`). Light is the codified default at `:root` — out of sync with brand direction. The actual default theme behaviour depends on `useTheme.tsx` initial state.
8. **No global CSS reset for `<button>` cursor** — relies on shadcn `<Button>`. Native `<button>` elements outside the system render with default OS cursor.
9. **271 components, no Storybook / visual-regression harness** — design changes can only be QA'd by route-walking the live app.
10. **Neon-border `@property` requires Houdini CSS Properties API** — Firefox <128 falls back to a static gradient (the rotation freezes). Acceptable, not blocking.

---

## 10. Verification status

| Item                                       | Verified by                                          |
|--------------------------------------------|------------------------------------------------------|
| Token catalogue (light + dark)             | Full read of `index.css` L11–L163                    |
| Tailwind extension surface                 | Full read of `tailwind.config.ts`                    |
| 49 shadcn primitives                       | `ls src/components/ui` listing                       |
| 271 total components                       | `find src/components -name '*.tsx'`                  |
| Subdirectory file counts                   | Per-directory `find` listing                         |
| Button cva() variants                      | Full file read                                       |
| Container override + safe-area utilities   | `index.css` L253–L352 read                           |
| Animation keyframes                        | `tailwind.config.ts` L72–L122                        |
| Neon border CSS                            | `index.css` L354–L407                                |
| Heading + body type rules                  | `index.css` L201–L244                                |

**NOT VERIFIED (deferred):**
- That every component in `src/components/` actually uses semantic tokens (large-scale grep would surface raw-colour drift but is out of scope for this blueprint).
- Mobile-specific UI memories (`style/mobile-judging-experience`, `style/mobile-app-experience`) — referenced but their concrete components weren't read here.
- Storybook / visual-regression coverage — confirmed absent (no `*.stories.tsx`, no `chromatic` config in `package.json` per repo listing).

---

**Next:** Step 3 — Risk / Tech-Debt Register.
