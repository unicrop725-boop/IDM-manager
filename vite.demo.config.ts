import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Builds the real FlowGet UI in demo mode (simulated backend) for the website: `npm run build:demo`.
// Output goes straight into the website's static files, where it is served at /app-demo/.
export default defineConfig({
  mode: "demo",
  plugins: [react(), tailwindcss()],
  base: "/app-demo/",
  build: {
    outDir: "website/public/app-demo",
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
  },
});
