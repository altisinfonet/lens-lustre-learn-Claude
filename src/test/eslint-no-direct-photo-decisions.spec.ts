/**
 * Phase 4 — ESLint chokepoint enforcement spec.
 * Verifies `audit-v6/no-direct-photo-decisions-import` blocks bypassing
 * `fetchPhotoStatusMaps` while permitting type-only imports + allowlisted files.
 */
import { describe, it, expect } from "vitest";
import { RuleTester } from "eslint";
import rule from "../../eslint-rules/no-direct-photo-decisions-import.js";

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

describe("audit-v6/no-direct-photo-decisions-import", () => {
  it("runs RuleTester suite", () => {
    tester.run("no-direct-photo-decisions-import", rule, {
      valid: [
        // Chokepoint itself may import the primitives.
        {
          filename: "/repo/src/lib/perPhotoStatus.ts",
          code: `import { fetchPhotoConsensus, buildPhotoStatusMaps } from "@/hooks/judging/usePhotoDecisions";`,
        },
        {
          filename: "/repo/src/lib/perPhotoStatus.ts",
          code: `import { fetchPhotoPlacements } from "@/hooks/judging/usePhotoPlacements";`,
        },
        // Type-only imports are always allowed.
        {
          filename: "/repo/src/pages/SubmissionDetail.tsx",
          code: `import type { PerPhotoStatus } from "@/hooks/judging/usePhotoDecisions";`,
        },
        {
          filename: "/repo/src/components/foo/Bar.tsx",
          code: `import { type PerPhotoStatus } from "@/hooks/judging/usePhotoDecisions";`,
        },
        // Tests may import directly.
        {
          filename: "/repo/src/test/per-photo.spec.ts",
          code: `import { usePhotoDecisions } from "@/hooks/judging/usePhotoDecisions";`,
        },
        // Unrelated imports unaffected.
        {
          filename: "/repo/src/components/foo/Bar.tsx",
          code: `import { fetchPhotoStatusMaps } from "@/lib/perPhotoStatus";`,
        },
      ],
      invalid: [
        {
          filename: "/repo/src/components/foo/Bar.tsx",
          code: `import { usePhotoDecisions } from "@/hooks/judging/usePhotoDecisions";`,
          errors: [{ messageId: "forbidden" }],
        },
        {
          filename: "/repo/src/pages/Dashboard.tsx",
          code: `import { fetchPhotoConsensus } from "@/hooks/judging/usePhotoDecisions";`,
          errors: [{ messageId: "forbidden" }],
        },
        {
          filename: "/repo/src/hooks/dashboard/useDashboardData.ts",
          code: `import { buildPhotoStatusMaps } from "@/hooks/judging/usePhotoDecisions";`,
          errors: [{ messageId: "forbidden" }],
        },
        {
          filename: "/repo/src/components/foo/Bar.tsx",
          code: `import { usePhotoPlacements } from "@/hooks/judging/usePhotoPlacements";`,
          errors: [{ messageId: "forbidden" }],
        },
        // Mixed: type allowed, value blocked.
        {
          filename: "/repo/src/components/foo/Bar.tsx",
          code: `import { type PerPhotoStatus, usePhotoDecisions } from "@/hooks/judging/usePhotoDecisions";`,
          errors: [{ messageId: "forbidden" }],
        },
      ],
    });
    expect(true).toBe(true);
  });
});
