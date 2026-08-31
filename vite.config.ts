import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { ViteImageOptimizer } from "vite-plugin-image-optimizer";
import { laneDefine, laneHtmlTokens } from "./scripts/lane-config.mjs";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * `index.html` GETS THE LANE FROM lane-config.mjs, NOT FROM Vite's env lookup.
 *
 * Vite's built-in `%VITE_X%` replacement in index.html reads the environment and
 * has NO fallback: an unset variable leaves the token in the shipped HTML and
 * emits only a warning. That is how www.50mmretina.com came to serve
 * `var origin = "%VITE_SITE_ORIGIN%"` and lose its apex→www redirect, while
 * staging — whose Pages project did define the variable — looked perfect.
 *
 * This plugin substitutes the lane tokens itself, through laneValue()'s rule
 * (unset -> production, "" -> build failure), BEFORE Vite's replacement runs.
 * Vite then finds nothing left to do for these tokens. Variables that are
 * genuinely per-deployment and have no sensible default — %VITE_SUPABASE_URL% —
 * are deliberately left to Vite, and scripts/verify-html-tokens.mjs fails the
 * build if any of those go unresolved.
 * ─────────────────────────────────────────────────────────────────────────────
 */
function laneHtmlPlugin() {
  const tokens: Record<string, string> = laneHtmlTokens();
  const pattern = new RegExp(`%(${Object.keys(tokens).join("|")})%`, "g");
  return {
    name: "lane-html-tokens",
    enforce: "pre" as const,
    transformIndexHtml: {
      order: "pre" as const,
      handler(html: string) {
        return html.replace(pattern, (_match, key: string) => tokens[key]);
      },
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  /**
   * This lane's addresses, resolved at build time. The production defaults and
   * the "empty is not a default" rule live in scripts/lane-config.mjs, so that
   * src/ contains no host literal and a staging bundle carries no production
   * string. See src/lib/env.ts.
   */
  define: laneDefine(),
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    laneHtmlPlugin(),
    react(),
    mode === "development" && componentTagger(),
    ViteImageOptimizer({
      jpg: { quality: 70 },
      jpeg: { quality: 70 },
      png: { quality: 75 },
      webp: { quality: 75 },
    }),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "@tanstack/react-query", "@tanstack/query-core"],
  },
  /**
   * SOW v2.1 — Step 3: Vendor chunk isolation.
   * framer-motion (~55KB gz) and react-markdown (~30KB gz) are isolated into
   * standalone chunks so they: (a) load in parallel with route chunks instead
   * of bloating them, (b) cache independently across navigations, (c) never
   * appear in /judge first paint when not yet imported. This is the correct
   * fix for the <350KB Lighthouse JS payload gate — per-component dynamic
   * imports of a singleton library would only create waterfalls.
   */
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          "vendor-framer-motion": ["framer-motion"],
          "vendor-react-markdown": ["react-markdown"],
          "vendor-react": ["react", "react-dom", "react-router-dom"],
          "vendor-query": ["@tanstack/react-query", "@tanstack/query-core"],
        },
      },
    },
  },
}));
