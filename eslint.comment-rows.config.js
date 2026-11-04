/**
 * C3 — the ONE-RULE ESLint config CI runs for the comment-row ratchet.
 *
 * A separate config for the reason eslint.bare-img.config.js gives: the main
 * eslint.config.js is not run in CI, so a rule added only there enforces
 * nothing. `.github/workflows/d2-comment-rows.yml` runs this one. The same rule
 * is registered in eslint.config.js so editors show it.
 */
import tseslint from "typescript-eslint";
import noCommentRows from "./eslint-rules/no-comment-rows.js";

export default tseslint.config({
  files: ["src/**/*.tsx"],
  ignores: ["**/__tests__/**", "**/*.test.tsx", "src/uiharness/**"],
  languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
  linterOptions: { reportUnusedDisableDirectives: "off", noInlineConfig: true },
  plugins: { d2: { rules: { "no-comment-rows": noCommentRows } } },
  rules: { "d2/no-comment-rows": "error" },
});
