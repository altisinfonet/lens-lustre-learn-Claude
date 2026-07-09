---
name: per-photo-chokepoint-eslint
description: ESLint rule audit-v6/no-direct-photo-decisions-import enforces the Phase-4 perPhotoStatus chokepoint
type: constraint
---
## Rule

`audit-v6/no-direct-photo-decisions-import` (file: `eslint-rules/no-direct-photo-decisions-import.js`) blocks **value** imports of:

- `usePhotoDecisions`, `usePhotoPlacements`
- `fetchPhotoConsensus`, `fetchPhotoPlacements`
- `buildPhotoStatusMaps`

…from `@/hooks/judging/usePhotoDecisions` or `@/hooks/judging/usePhotoPlacements` anywhere except the allowlist:

- `src/lib/perPhotoStatus.ts` (the chokepoint that calls both in parallel and merges)
- `src/hooks/judging/usePhotoDecisions.ts` / `usePhotoPlacements.ts` (definition sites)
- `src/lib/judging/mergeConsensusAndPlacement.ts`
- `src/test/**`

## Type-only imports allowed

`import type { PerPhotoStatus } from "@/hooks/judging/usePhotoDecisions"` and `import { type PerPhotoStatus }` are intentionally permitted (no runtime effect).

## Why

A new component that imports `usePhotoDecisions` directly bypasses the merge with `fetchPhotoPlacements` and silently drops R4 labels (winner / runner-up / honorary / top_50 / top_100) on the per-photo grid — the exact bug Phase 3 fixed for `sendipannita2@gmail.com`.

## Sanctioned consumer API

```ts
import { fetchPhotoStatusMaps } from "@/lib/perPhotoStatus";
```

## Tests

- `src/test/eslint-no-direct-photo-decisions.spec.ts` (RuleTester: 6 valid + 5 invalid)
- Live positive: `bunx eslint <file-importing-usePhotoDecisions>` → "Audit v6 Phase 4: do not import …"
