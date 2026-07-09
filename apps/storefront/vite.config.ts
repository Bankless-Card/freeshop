import { defineConfig } from "vitest/config";

// Deliberately merchant-friendly output:
// · base "./" so the built site works from any path (GitHub Pages project sites, Cloudflare
//   Pages, a plain file server) without configuration
// · unminified JS with stable names — the deployed folder is meant to be read and hand-edited
//   (index.html and styles.css are shipped as plain editable files; see README in the zip)
export default defineConfig({
  base: "./",
  build: {
    minify: false,
    rolldownOptions: {
      output: {
        entryFileNames: "assets/app.js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
  test: {
    environment: "happy-dom",
  },
});
