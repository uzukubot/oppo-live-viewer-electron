// vite.config.js 通过 `define` 注入构建时的 GITHUB_SHA（前 7 位）。
// 本地开发（npm run tauri dev）无该变量 → "dev"。
declare const __APP_COMMIT__: string;

/** 当前构建的短 commit ID（CI 注入；本地开发为 "dev"）。 */
export const APP_COMMIT: string = __APP_COMMIT__ ?? "dev";
