import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base "./" so the built site works from any path (GitHub Pages project sites,
// Cloudflare Pages, or a plain file server) without configuration.
export default defineConfig({
  plugins: [react()],
  base: "./",
});
