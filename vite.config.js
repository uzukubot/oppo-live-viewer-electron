import { defineConfig } from "vite";
import { sveltekit } from "@sveltejs/kit/vite";

const commit = process.env.GITHUB_SHA ? process.env.GITHUB_SHA.slice(0, 7) : "dev";

// https://vite.dev/config/
export default defineConfig(() => ({
  plugins: [sveltekit()],

  // Electron 用 loadFile(file://) 加载构建产物，必须用相对路径（否则 /_app/... 解析失败）
  base: "./",

  // 注入构建时的 commit ID（GitHub Actions 提供 GITHUB_SHA；本地为 "dev"）
  define: {
    __APP_COMMIT__: JSON.stringify(commit),
  },

  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
}));
