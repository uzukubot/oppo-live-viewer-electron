import { openPath as apiOpenPath, startScan } from "./api";
import type { PhotoMeta } from "./types";
import { app, setPhotos } from "./state.svelte";
import { photoCache } from "./viewer/photoCache";

/** 弹出文件夹选择框并打开。 */
export async function pickFolder() {
  const dir = await window.api.pickFolder();
  if (dir) {
    await openFolder(dir);
  }
}

let listenersReady = false;

/**
 * 注册一次流式扫描事件监听。主进程后台逐批推送 scan-batch / scan-done，
 * 前端边收边追加到 app.photos，列表立即可用。
 */
async function ensureScanListeners() {
  if (listenersReady) return;
  listenersReady = true;
  window.api.onScanBatch((payload: { folder: string; photos: PhotoMeta[] }) => {
    if (payload.folder !== app.folder) return; // 忽略旧扫描的迟到批次
    app.photos = [...app.photos, ...payload.photos];
  });
  window.api.onScanDone((payload: { folder: string }) => {
    if (payload.folder !== app.folder) return;
    app.scanning = false;
  });
}

/** 打开指定文件夹：立即出第一批文件名，后台继续流式填充。 */
export async function openFolder(folder: string) {
  app.error = "";
  try {
    await ensureScanListeners();
    photoCache.clear();
    setPhotos(folder, []);
    app.scanning = true;
    const res = await startScan(folder);
    app.scanTotal = res.total;
    rememberFolder(folder);
    if (res.total === 0) {
      app.scanning = false;
      app.error = "该文件夹中没有支持的图片";
    }
  } catch (e) {
    app.error = e instanceof Error ? e.message : String(e);
    app.scanning = false;
  }
}

function rememberFolder(folder: string) {
  app.lastOpened = folder;
  try {
    localStorage.setItem("lastFolder", folder);
  } catch {
    /* 忽略存储失败 */
  }
}

/** 打开路径（拖拽或命令行）：文件直接进查看器并流式填充其所在目录。 */
export async function openPath(path: string) {
  app.error = "";
  try {
    await ensureScanListeners();
    const res = await apiOpenPath(path);
    photoCache.clear();
    setPhotos(res.folder, []);
    app.index = res.index;
    app.scanning = true;
    app.scanTotal = res.total;
    rememberFolder(res.folder);
    if (res.total === 0) {
      app.scanning = false;
      app.error = "该文件夹中没有支持的图片";
    } else {
      // 启动流式扫描，填充前后翻页所需的其他图片
      const s = await startScan(res.folder);
      app.scanTotal = s.total;
    }
  } catch (e) {
    app.error = e instanceof Error ? e.message : String(e);
    app.scanning = false;
  }
}
