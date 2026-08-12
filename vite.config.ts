import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri 가 기대하는 고정 포트. 실패 시 조용히 다른 포트로 옮겨가면
// 창이 빈 화면으로 뜨므로 strictPort 로 못 박는다.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    target: "chrome110",
    sourcemap: true,
  },
});
