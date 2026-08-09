import type { PhotoMeta } from "./types";

/** 全局应用状态（Svelte 5 runes）。 */
export const app = $state({
  photos: [] as PhotoMeta[],
  folder: "",
  index: 0,
  error: "" as string,
  lastOpened: "" as string,
  /** 是否仍在流式扫描（列表会边扫边追加）。 */
  scanning: false,
  /** 文件夹内图片总数（来自 start_scan / open_path）。 */
  scanTotal: 0,
  /** 侧边栏内容：默认文件名列表（省资源），缩略图网格需手动开启。 */
  viewMode: "list" as "list" | "grid",
  /** 侧边栏是否可见（可隐藏，隐藏后仅剩查看器）。 */
  sidebarVisible: true,
  /** 侧边栏宽度（可拖拽调整）。 */
  sidebarWidth: 300,
  /** 诊断面板开关（F12）。 */
  showDiag: false,
  /** 文件名搜索关键词（过滤列表显示）。 */
  search: "",
});

export function setPhotos(folder: string, photos: PhotoMeta[]) {
  app.photos = photos;
  app.folder = folder;
  app.index = 0;
  app.error = "";
}

export function show(index: number) {
  if (index < 0 || index >= app.photos.length) return;
  app.index = index;
}

export function next() {
  if (app.photos.length === 0) return;
  app.index = (app.index + 1) % app.photos.length;
}

export function prev() {
  if (app.photos.length === 0) return;
  app.index = (app.index - 1 + app.photos.length) % app.photos.length;
}
