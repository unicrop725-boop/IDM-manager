import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Tauri expects a fixed dev-server port (see src-tauri/tauri.conf.json -> build.devUrl).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  // The animated backgrounds are loaded on demand. Preparing them at startup stops the dev server from
  // re-bundling (and reloading the page) the first time one is chosen.
  optimizeDeps: {
    include: [
      "threejs-components/build/backgrounds/liquid1.min.js",
      "threejs-components/build/backgrounds/neon1.min.js",
      "threejs-components/build/backgrounds/starfield1.min.js",
      "threejs-components/build/backgrounds/tunnel1.min.js",
      "threejs-components/build/backgrounds/bokeh1.min.js",
      "simple-icons",
    ],
  },
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // Never let the frontend watcher look at the Rust side.
      ignored: ["**/src-tauri/**"],
    },
  },
});
