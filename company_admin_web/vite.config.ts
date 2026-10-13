import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  return {
    plugins: [react()],
    server: { host: "127.0.0.1", port: 8080, strictPort: true },
    preview: { host: "127.0.0.1", port: 8080, strictPort: true },
    test: {
      environment: "jsdom",
      setupFiles: ["./src/test/setup.ts"],
      exclude: ["node_modules/**", ".tools/**", "dist/**"],
    },
    // No proxy or backend changes. Only the public API URL is exposed to the app.
    define: {
      "import.meta.env.VITE_ORDER_API_BASE_URL": JSON.stringify(
        env.VITE_ORDER_API_BASE_URL || "http://127.0.0.1:8001",
      ),
    },
  };
});
