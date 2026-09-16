# ANDROID BUILD #114 — THE GATE REFUSED, AND IT WAS RIGHT TO
### 2026-08-31. Finding, cause, and the verified repair.

## What happened

Android Build **#114** (`ea68174`, v1.2.17, versionCode 1114) reached `build-aab`, ran 11m 4s and **refused to produce an `.aab`:**

```
MISSING from bundle: Edit-caret fix (2026-08-12) (marker 'caretPlaced').
This AAB would NOT contain that feature. Refusing to build.
```

The security gate and the UI gate both **passed**. Only the feature-proof step stopped it.

## The cause — the marker moved, not the feature

`android-build.yml`'s "Prove the synced app is TODAY'S app" step greps the **built bundle** for six literal strings, one per feature it will not ship without.

`caretPlaced` lived in `src/components/ads/AdComments.tsx` as `el.dataset.caretPlaced` — present at `32930e7` and `9160b75`, the last two green Android builds. The **2026-08-31 promotion (`789d4554`)** replaced that hand-rolled comment row with the shared `CommentThread`. The behaviour moved; the string did not.

| Commit | `caretPlaced` in `AdComments.tsx` |
|---|---|
| `32930e7` (build #112, green) | 2 |
| `d1b2b1c5` (pre-promotion) | 2 |
| `789d4554` (the promotion) | **0** |
| `86a17dd1`, `ea68174f` | 0 |

**This was NOT caused by the F-53 / @mention change.** That change touched `MentionInput.tsx`; the marker was in `AdComments.tsx` and was already gone at `789d4554`, before it.

## The feature is present — proven by reading the code, not asserted

1. `AdComments.tsx:181` renders `<CommentThread …>`; its own header says the drawing moved there.
2. `CommentThread.tsx:312–321` — when `editingId === comment.id` it renders `<MentionInput … autoFocus />`.
3. `MentionInput.tsx` — on `autoFocus`, one animation frame later, `el.setSelectionRange(end, end)`, guarded so it never steals the caret from a member who has already clicked into the text.

So editing an ad comment still places the caret at the end. **The gate is keyed to an implementation detail, so a re-write reads exactly like a deletion and it cannot tell them apart.**

**This was predicted in this repository on 2026-08-13.** `POST_REMEDIATION_FORENSIC_AUDIT_2026-08-13.md:99`: the step *"greps for six hardcoded feature strings from 2026-08-12 … It cannot prove any newer work is, and **it breaks on a copy change**."*

## The repair — the gate is NOT weakened

Two files, two functional lines.

1. **`src/components/MentionInput.tsx`** — one line added, `el.dataset.caretPlaced = "1";`, immediately after the `setSelectionRange` call, with a comment recording why it exists and what breaks if it is removed. A `dataset` key is used deliberately: **minification renames locals but never a `dataset` property**, so the string genuinely survives into the artefact the gate reads.
2. **`.github/workflows/android-build.yml`** — the check's description now names the marker's new home, with a comment recording the move and the evidence. **The marker string and the refusal behaviour are unchanged**, so the gate is exactly as strong as before.

Deleting the check was never on the table. That would trade a real release gate for a green tick.

## Verified in the artefact, not in the source

Built `origin/main` + the marker, with production's environment, then ran the gate's own six greps against `dist/assets/*.js`:

```
OK   get_contributor_scores
OK   Top Contributor
OK   All categories
OK   Photojournalism
OK   Pinned comment
OK   caretPlaced        <- was MISSING, now present in the minified bundle
```

Build exit 0, and `verify-html-tokens` passed. Affected tests: **45 passed, 0 failed** across `MentionSuggestionsFitOnScreen`, `SendButtonTapTarget`, `ComposerEnterKey`, `CommentLineBreaks`, `noComponentDefinedInRender`.

## Version

`versionName` stays **1.2.17**. Run #114 produced no artifact, so the name is not spent — the same handling the workflow's notes record for builds 1105, 1107 and 1109.

## Status

**PREPARED AND VERIFIED, NOT PUSHED.** The browser link dropped before the re-cut could be pushed, and this session holds no git push credential.

## Standing finding

The six markers are hardcoded strings from 2026-08-12. **Five of the six are UI copy** (`Top Contributor`, `All categories`, `Photojournalism`, `Pinned comment`) or an RPC name. Any wording change or refactor breaks the build in a way that reads as a lost feature. The gate's intent is right and it has now caught something real twice; its instrument is brittle. Worth replacing the string greps with assertions tied to behaviour rather than to spelling.
