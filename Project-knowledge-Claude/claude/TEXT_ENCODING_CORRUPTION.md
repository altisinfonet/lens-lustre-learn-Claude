# The boxes in the text were never a font problem

> Written 2026-08-03, after PR #50. Everything here was measured on production.

---

## 1. The report

The owner: *"Why All font is just unreadable?? What is the font what we have used
in entire site, one font or multiple font??"* — with a screenshot of the feed
sidebar showing `SEE ALL Ã¢ÂÂ`.

The instinct — and mine, initially — is that this is a font problem. It is not.

## 2. The cause, in one paragraph

Read out of the **live DOM** on `50mmretina.com/feed`, build `2026-08-02-09`:

```
"See All " → 53 65 65 20 41 6c 6c 20 | U+00E2 U+0086 U+0092
```

The character that belongs there is **U+2192 `→`**, whose UTF-8 bytes are exactly
`E2 86 92`. Those three bytes were decoded as **Latin-1** into three separate
characters and saved that way.

- `U+00E2` is `â` — a real letter, renders perfectly
- `U+0086` and `U+0092` are **C1 control characters**. No font contains a glyph
  for them, so every font draws a box.

**No typeface could ever have fixed this.** Font rendering was healthy the whole
time: computed `font-family` on `<body>`, `<h1>` and every element returned
`Inter, Helvetica, Arial, sans-serif`, with Inter loaded across 62 faces.

## 3. Scope — and the mistake I made measuring it

**First pass: I reported 41 occurrences, 11 member-visible. That was wrong.**
I had scanned for a hand-written list of known 3-byte signatures (`—`, `→`, `…`,
`✓`, `•`) and so **missed every emoji**, which are 4 bytes and become four
characters when misread.

A generic detector — *any* run of 2+ characters in U+0080..U+00FF that is valid
UTF-8 when re-encoded as Latin-1 — found the truth:

**74 damaged runs across 6 files. 41 of them rendered to members.**

| Surface | Was | Should be |
|---|---|---|
| every competition placement badge | box | 🏆 🥈 🥉 🎖 ⚖️ 🌟 ✨ ⭐ 👁 |
| every round status icon | box | ✓ ★ ✗ ⚠ |
| sidebar medal helper | box | 🏆 🥇 🥈 🥉 |
| four sidebar links | `See All â□□` | `See All →` |
| pinned-comment marker | box | 📌 |
| both comment placeholders | `Write a replyâ□□` | `Write a reply…` |
| unvote warning | `2Ã the reward` | `2× the reward` |

The other 33 sat in `//` and `{/* */}` comments and never rendered.

**Lesson: never enumerate the damage by hand. Enumerate it by property.** The
signature list felt thorough and was 45% incomplete.

## 4. How it was repaired

Each damaged run was re-encoded as Latin-1 and decoded as UTF-8 — the exact
inverse of the damage. Nothing was hand-typed, so nothing could be guessed wrong.
Re-scan afterwards: **0 remaining**.

The transform is safe because it cannot fire on legitimate text:

- a single accented letter (`é`) is one character — the run needs two
- a genuine pair (`ää`) is not valid UTF-8 when re-encoded, so it throws
- a repair yielding a control character is rejected

Proven across 1497 text files with **zero false positives** — including
`src/i18n/translations.ts`, which holds ~120,000 Devanagari, Tamil, Telugu,
Bengali and Gujarati characters and was completely clean.

## 5. The tripwire

`src/__tests__/sourceEncoding.test.ts` fails the build if this returns.

It exists because **nobody typed those characters**. A tool in the chain read a
UTF-8 file as Latin-1 and re-saved it, and whatever did that can do it again.
The damage is invisible in normal review — `â` looks like a typo, not corruption.
The same tool also left `src/index.css:5` reading *"Facebook system font stack —
no external font imports needed"* directly above three external font imports.

**Mutation-checked before shipping:** re-broke one arrow in
`FeedRightSidebar.tsx` → test went red and named the file, line, code points and
intended character. Restored → green.

It also caught corruption **in its own file** on the first run, because the
sample string had been written literally. Building it from `String.fromCharCode`
fixed that — and it is a fair demonstration that the detector works.

## 6. Proof taken after it shipped

PR #50, merged as `51f26f8`, deployed as build `2026-08-03-01`.

On the live feed after deploy:

- **0 garbled text nodes** (was 4 on that page)
- `See All →` now reads as the single code point `U+2192`
- in the shipped bundle: `Write a reply` + `U+2026`, `Add a comment` + `U+2026`
- medal helper emits `U+1F947` 🥇 / `U+1F948` 🥈 / `U+1F949` 🥉

Gates: `npx tsc --noEmit -p tsconfig.app.json` exit 0 · full suite 383 passed,
21 failed = exactly the documented pre-existing set (PhaseWatermark 18,
JudgeGuideModal 1, complete-round-progression 2) · all 8 files verified
byte-for-byte on GitHub by SHA-256 after upload.

## 7. The real readability finding, still open

While measuring, I sampled every visible text element on the live feed. Of **168**
of them, **70 — 42% — are smaller than 12px**. Forty-one are **9px**. Six are
**7px**. Body base is 14px at line-height **1.34**.

iOS's minimum recommended size is 11pt; Android Material's smallest body style is
12sp; Instagram and LinkedIn sit at 1.4–1.5 line-height.

**That is a separate, unfixed problem, and it is the larger one.** No font choice
addresses it. Owner has been shown the measurements; the change is not made.

## 8. Related: the font question that prompted this

Measured, not assumed:

- The site is **effectively one font — Inter**, declared four times across two
  parallel systems (`index.css:1-3` imports, `index.css:77-79` display/heading/body
  — **all three the identical string** — `index.css:86-88` sans/serif/mono, and a
  literal duplicate in `tailwind.config.ts:123-155`).
- Real usage is **2,091 inline `style={{ fontFamily: "var(--font-*)" }}` props**
  across 248 files, plus 16 arbitrary-value classes and 83 `font-mono`.
  `font-sans` and `font-serif`: **0 usages each**.
- **Lora is imported on every page load and used nowhere.**
- **Changing the font is 3 lines in `src/index.css` (77-79)** — no component edits.
  Add `tailwind.config.ts` and `index.html` to also cover mono and the splash.
- The stack has **no `-apple-system`, no `Segoe UI`, no `Roboto`** — so before
  Inter loads, Windows and the Android app fall back to Arial, not the platform font.
- **Inter, Roboto, Geist and Manrope cover none of the five Indic scripts the site
  ships** — measured by rendering real text against a null-font reference on the
  live site. Any Latin font choice is cosmetic for six of seven languages.
