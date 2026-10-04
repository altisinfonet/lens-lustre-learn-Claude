/**
 * P11 — the ONE-RULE ESLint config CI runs for the bare-<img> ratchet.
 *
 * Why a separate config: the main `eslint.config.js` reports ~1,860 existing
 * errors across src/ (2026-10-04) and is not run in CI, so adding a rule there
 * alone would enforce nothing. This config enables exactly one rule, over
 * exactly the directories the P11 gate names, and is what
 * `.github/workflows/d2-bare-img.yml` runs. The same rule is also registered in
 * eslint.config.js so editors show it.
 */
import tseslint from "typescript-eslint";
import noBareImg from "./eslint-rules/no-bare-img.js";

export default tseslint.config({
  files: ["src/components/**/*.tsx", "src/pages/**/*.tsx"],
  ignores: ["**/__tests__/**", "**/*.test.tsx"],
  languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
  linterOptions: { reportUnusedDisableDirectives: "off", noInlineConfig: true },
  plugins: { d2: { rules: { "no-bare-img": noBareImg } } },
  rules: { "d2/no-bare-img": "error" },
});
