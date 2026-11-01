/// <reference types="vitest" />
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// The CSP meta tag in index.html forbids inline scripts. The dev server's React refresh
// preamble is an inline script, so the tag is stripped while serving in development only.
// Production builds ship it untouched.
const devCspStrip = (): Plugin => ({
  name: "paper-desk-dev-csp",
  apply: "serve",
  transformIndexHtml: (html) => html.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>\s*/, ""),
});

export default defineConfig({
  base: "./",
  plugins: [react(), devCspStrip()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    assetsInlineLimit: 0,
    sourcemap: false,
    modulePreload: { polyfill: false },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
