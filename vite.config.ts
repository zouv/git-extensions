import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  // 前端产物放 .runtime/dist，项目根 dist/ 只放打包发布的成品（dist/release），
  // 避免 vite build 清空 dist 时删掉安装包与便携 zip。
  build: {
    outDir: ".runtime/dist",
    emptyOutDir: true,
  },
  server: {
    // Tauri 官方模板默认 1420，但本机 ScCode 也用 1420；本项目固定 1421 以便同时开发。
    port: 1421,
    strictPort: true,
  },
  envPrefix: ["VITE_", "TAURI_"],
});
