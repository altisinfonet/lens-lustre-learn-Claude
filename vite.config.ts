import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { ViteImageOptimizer } from "vite-plugin-image-optimizer";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
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
