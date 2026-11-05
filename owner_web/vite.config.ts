import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// 8080은 회사 관리자 웹이 쓰므로 점주 웹은 8081에 고정한다.
export default defineConfig({
  plugins: [react()],
  server: { host: "127.0.0.1", port: 8081, strictPort: true },
  preview: { host: "127.0.0.1", port: 8081, strictPort: true },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    // 테스트는 서버 없이 돈다. 기본값이나 개인 .env.local의 api 설정을 따르지 않게 Mock을 명시한다.
    env: {
      VITE_OWNER_AUTH_SOURCE: "mock",
      VITE_OWNER_DATA_SOURCE: "mock",
    },
    exclude: ["node_modules/**", "dist/**"],
  },
});
