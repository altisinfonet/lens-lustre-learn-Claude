import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import requirePhaseWatermark from "./eslint-rules/require-phase-watermark.js";
import noRawEntryStatus from "./eslint-rules/no-raw-entry-status.js";
import noDirectTransactionalEmail from "./eslint-rules/no-direct-transactional-email.js";
import noUnfilteredJudgeRealtime from "./eslint-rules/no-unfiltered-judge-realtime.js";
import noLegacyDecisionStrings from "./eslint-rules/no-legacy-decision-strings.js";
import noRawCatalogLabels from "./eslint-rules/no-raw-catalog-labels.js";
import noDirectPhotoDecisionsImport from "./eslint-rules/no-direct-photo-decisions-import.js";
import noRawProgressionDecision from "./eslint-rules/no-raw-progression-decision.js";
import noAsAnyInProtectedDirs from "./eslint-rules/no-as-any-in-protected-dirs.js";
import noDirectWalletLedgerWrites from "./eslint-rules/no-direct-wallet-ledger-writes.js";
import noUnfilteredRealtimeSensitive from "./eslint-rules/no-unfiltered-realtime-sensitive.js";
import noUnsafeEdgeAuthority from "./eslint-rules/no-unsafe-edge-authority.js";
import noRawTailwindColors from "./eslint-rules/no-raw-tailwind-colors.js";

export default tseslint.config(
  { ignores: ["dist", "eslint-rules/**"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
      "competition-watermark": {
        rules: { "require-phase-watermark": requirePhaseWatermark },
      },
      "audit-v6": {
        rules: {
          "no-raw-entry-status": noRawEntryStatus,
          "no-direct-transactional-email": noDirectTransactionalEmail,
          "no-unfiltered-judge-realtime": noUnfilteredJudgeRealtime,
          "no-legacy-decision-strings": noLegacyDecisionStrings,
          "no-raw-catalog-labels": noRawCatalogLabels,
          "no-direct-photo-decisions-import": noDirectPhotoDecisionsImport,
          "no-raw-progression-decision": noRawProgressionDecision,
          "no-as-any-in-protected-dirs": noAsAnyInProtectedDirs,
          "no-direct-wallet-ledger-writes": noDirectWalletLedgerWrites,
          "no-unfiltered-realtime-sensitive": noUnfilteredRealtimeSensitive,
          "no-unsafe-edge-authority": noUnsafeEdgeAuthority,
          "no-raw-tailwind-colors": noRawTailwindColors,
        },
      },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": "off",
      "competition-watermark/require-phase-watermark": "error",
      "audit-v6/no-raw-entry-status": "error",
      "audit-v6/no-direct-transactional-email": "error",
      "audit-v6/no-unfiltered-judge-realtime": "error",
      "audit-v6/no-legacy-decision-strings": "error",
      "audit-v6/no-raw-catalog-labels": "error",
      "audit-v6/no-direct-photo-decisions-import": "error",
      "audit-v6/no-raw-progression-decision": "error",
      "audit-v6/no-as-any-in-protected-dirs": "error",
      "audit-v6/no-direct-wallet-ledger-writes": "error",
      "audit-v6/no-unfiltered-realtime-sensitive": "error",
      // Phase 4 slice — baseline as warn until existing src/** raw-color usage is migrated.
      "audit-v6/no-raw-tailwind-colors": "warn",
    },
  },
  // R6 — extend audit-v6 forbidden-pattern coverage to edge functions.
  // Keep the rule list narrow (no react-hooks, no browser globals) since
  // these run in Deno, not the browser.
  {
    files: ["supabase/functions/**/*.ts"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.node, Deno: "readonly" },
    },
    // `audit-v6` plugin already registered in the main config above.
    rules: {
      "audit-v6/no-raw-entry-status": "error",
      "audit-v6/no-direct-transactional-email": "error",
      // Phase R7 — block legacy progression vocabulary in edge fns too.
      // The rule's own DIR_ALLOWLIST already permits eslint-rules/** & test/**.
      "audit-v6/no-legacy-decision-strings": "error",
      "audit-v6/no-raw-catalog-labels": "error",
      "audit-v6/no-raw-progression-decision": "error",
      "audit-v6/no-as-any-in-protected-dirs": "error",
      "audit-v6/no-unsafe-edge-authority": "error",
    },
  },
  // Phase 4 Slice B — admin layout primitives are token-only by contract.
  // Flip raw-color rule to ERROR for primitives/** only (proven clean: 0 raw colors).
  // Rest of src/** stays at warn until additive state tokens land in Slice B.2.
  {
    files: ["src/components/admin/primitives/**/*.{ts,tsx}"],
    rules: {
      "audit-v6/no-raw-tailwind-colors": "error",
    },
  },
);
