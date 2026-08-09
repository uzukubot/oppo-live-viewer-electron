// Electron 用 loadFile(file://) 加载构建产物，需要相对路径的资源引用，
// 因此用 adapter-static + fallback（SPA 模式）+ paths.relative（相对资源路径）。
import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import('@sveltejs/kit').Config} */
const config = {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter({
      fallback: "index.html",
    }),
    paths: {
      relative: true,
    },
  },
};

export default config;
