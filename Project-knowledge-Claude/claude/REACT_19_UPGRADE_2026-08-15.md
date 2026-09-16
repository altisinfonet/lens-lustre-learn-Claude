# React 18 → React 19 — done, green, on origin (2026-08-15)

`origin/main` = **`fa80588`**. Working tree clean, 0 unpushed. Suite **1,692 passing**, 1 skipped.

Owner asked for it and chose the ordering: **React 19 first, build after.**

---

## What changed — the whole diff, in eight lines

| package | from | to |
|---|---|---|
| `react` | 18.3.1 | **19.2.8** |
| `react-dom` | 18.3.1 | **19.2.8** |
| `@types/react` | 18.3.23 | 19.2.18 |
| `@types/react-dom` | 18.3.7 | 19.2.4 |
| `@testing-library/react` | 16.0.0 | 16.3.2 |
| `@testing-library/dom` | *(absent)* | 10.4.1 |
| `vaul` | 0.9.9 | 1.1.2 |
| `next-themes` | 0.3.0 | 0.4.6 |

**Zero changes to `src/`.** Not one type error, not one component edit.

`vaul` and `next-themes` were the only two packages whose peer range hard-excluded React 19. Everything else — 27 Radix packages, framer-motion, react-router, TanStack Query — already accepted it.

## Gates

- `tsc --noEmit` → **0 errors**
- `vitest run` → **1,692 passing**, 1 skipped (137 files)
- `npm run build` → clean, `dist/` holds one HTML file
- `npm run ui:shot` → **24 screenshots, 0 problems** — the check that actually matters, because React 19's removals fail at RUN time, not compile time
- `npm ci` from the committed lockfile → **react 19.2.8 / react-dom 19.2.8**, proving a fresh checkout (CI, the Android build) gets 19 and not a resolver accident

## Measured before starting, not feared

- Our source uses **none** of the seven APIs React 19 removes — `findDOMNode`, `ReactDOM.render`, `ReactDOM.hydrate`, `unmountComponentAtNode`, `createFactory`, `defaultProps`, string refs. All scanned for.
- **`react-mentions@4.4.10`** — the package most likely to break given its age — was **opened and read**, not judged by its version. Zero uses of `findDOMNode`. Its `propTypes` ×7 and one `defaultProps` are ignored by React 19, not fatal.

## One package deliberately left behind — and it was checked, not assumed

**`react-day-picker` stays on 8.10.1.**

- Its bundle contains **zero** uses of anything React 19 removed. The stale peer range is a packaging fact, not a runtime one.
- v9/v10 rename exactly the pieces this app uses: `components.IconLeft` / `IconRight` became one `Chevron`, and the classNames keys changed.
- So upgrading means rewriting `src/components/ui/calendar.tsx` — which is the **post scheduler**. That deserves its own cycle with its own screenshots, not to be bolted onto an upgrade whose entire value is that nothing else moved.

## A failure worth remembering

Installing the React 19 types with `--legacy-peer-deps` **silently removed `@testing-library/dom`**, which v16 of `@testing-library/react` expects as a peer instead of bundling. Sixteen test files failed with `Cannot find module`. The suite caught it in seconds; a project without one would have shipped it.

## The new gate

`src/__tests__/reactVersion.test.ts` — 19 assertions. It checks what is **installed on disk**, not what `package.json` asks for, because a later `npm install` can quietly pull React 18 back under a stale peer range and everything would still compile. It also names the `react-day-picker` exception with its reasoning, so the next person finds a decision rather than a mystery.

Mutations, all caught: package.json back to 18 · types drift from runtime · next-themes reverts · a source file reintroduces `findDOMNode` · a source file reintroduces a string ref.

## Free win

`fetchPriority` in `src/components/post/PostMedia.tsx` is a React 19 property. On 18 it warned on every feed card and never reached the DOM. It now works, with no code change.

## Still DEVICE-open

React 19 compiles, tests, builds and renders here. Whether the **Android WebView** behaves identically is a question only the owner's phone can answer, and it stays open until it does. This is the single most important thing for the owner to check when the build lands.

---

## Next, in order

1. **Session-loss recorder** — the cause of every sign-out. Nothing records it today, so bugs 2 and 3 cannot be diagnosed until this ships in a build.
2. **`activity_logs` flood** — 5,697 rows where ~90 would be right.
3. **Token refresh exempt from the 25s abort.**
4. **Instagram-style upload composer.**
5. **Trigger the Android build** — bump `ANDROID_BUILD_TRIGGER`; the workflow fires on any push touching it. Only the owner uploads the AAB to Play.
