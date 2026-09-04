import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { activePlanPlugin } from "./vite/activePlanPlugin.mjs";

export default defineConfig({
  // `activePlanPlugin` serves the plan `taltree load` made active, read-only and in
  // dev only; it is the whole bridge between the plan library and the browser build.
  plugins: [react(), activePlanPlugin()],
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "bin/**/*.test.mjs", "vite/**/*.test.mjs"],
  },
});
