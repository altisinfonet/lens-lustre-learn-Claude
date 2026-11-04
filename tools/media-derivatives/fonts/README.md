# The credit font

`FiraSans-SemiBold-latin.ttf` is the one font the credit renderer
(`../credit-render.mjs`, geometry v5) draws with. It is committed so that every
machine draws the same glyphs at the same measured width.

- **Font:** Fira Sans SemiBold, Copyright (c) 2012-2015, The Mozilla Foundation and Telefonica S.A.
- **Licence:** SIL Open Font License, Version 1.1. The full text is in `OFL.txt`. The licence declares no Reserved Font Name, so the subset keeps the family name.
- **Source:** `https://raw.githubusercontent.com/google/fonts/main/ofl/firasans/FiraSans-SemiBold.ttf`, downloaded on 4 Nov 2026. The original file is 489,028 bytes, sha256 `db0321f83eb3e9f527b8af384a1b3fefdc1039cf2b06fd39b3f61492bda9561c`.
- **Subset:** made with `subset-font` 2.4.0 (HarfBuzz) as TrueType, 187,620 bytes, sha256 `c921598f36ab6c5148fe4d86f291de78e273aacf582178797a6a3b2a9aeab771`. It keeps these Unicode ranges:
  - U+0020–007E
  - U+00A0–024F (Latin-1, Latin Extended-A/B, including ©)
  - U+1E00–1EFF
  - U+2010–2027, U+2030–203A
  - U+20AC, U+2122

  A character outside these ranges, such as a name in another script, is drawn by Pango from the machine's fallback fonts.

`src/lib/media/__tests__/creditRenderV5.test.ts` checks the sha256 above against the committed file, so the font cannot change silently.
