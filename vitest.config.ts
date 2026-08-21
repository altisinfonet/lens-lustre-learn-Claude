import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    // Hermetic synthetic backend env for tests (isolation guard, 2026-08-21).
    // The committed .env used to supply these silently; tests must never depend
    // on a real environment, and CI provides none. Values are synthetic on purpose.
    env: {
      VITE_SUPABASE_URL: "https://testprojectref0000x.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "test-publishable-key-not-real",
      VITE_SUPABASE_PROJECT_ID: "testprojectref0000x",
    },
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
