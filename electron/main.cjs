'use strict';

const { app, BrowserWindow, protocol, dialog, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { isSupported, scanPhoto, fullMeta, naturalCompare } = require('./parser.cjs');
const { FileStore } = require('./store.cjs');

// ── 启动参数 ──

// Live 视频（HEVC/H.265）：Electron 官方 ffmpeg 不含 H.265，走平台硬件解码。
// Windows 依赖系统 HEVC 解码器（与 WebView2 现状相同）；macOS 走 VideoToolbox 原生。
app.commandLine.appendSwitch('enable-features', 'PlatformHEVCDecoderSupport');

// Windows 新 Chromium 默认把 HDR 内容按系统 SDR 亮度滑块 tone-map（与 Chrome 一致）。
// 若需"绝对 HDR"，放开下一行：
// app.commandLine.appendSwitch('disable-features', 'HlgPqSdrRelative');

// viewer:// 自定义协议（对应 Tauri 版的 viewer://），供字节给前端
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'viewer',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true,
    },
  },
]);

// ── 状态 ──

const store = new FileStore(24); // 字节 LRU 缓存上限 24
let mainWindow = null;
let scanToken = 0; // 代际：切换文件夹时旧扫描线程据此停止

const isDev = process.argv.includes('--dev') || !!process.env.VITE_DEV_SERVER_URL;
const screenshotArg = process.argv.find((a) => a.startsWith('--screenshot='));
const openPathArg = process.argv.find((a) => a.startsWith('--open-path='));

// ── 工具 ──

function send(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

function listImagePaths(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    throw new Error(`无法打开文件夹: ${e.message}`);
  }
  return entries
    .filter((e) => e.isFile() && isSupported(e.name))
    .map((e) => path.join(dir, e.name))
    .sort((a, b) => naturalCompare(path.basename(a), path.basename(b)));
}

/** 后台流式扫描：每 25 个推一批 scan-batch，结束推 scan-done。代际不符即停。 */
async function scanStream(folder, generation) {
  const BATCH = 25;
  let batch = [];
  for (;;) {
    const item = (() => {
      if (!store.scan || store.scan.generation !== generation) return null;
      if (store.scan.index >= store.scan.paths.length) return { done: true };
      const p = store.scan.paths[store.scan.index];
      store.scan.index += 1;
      return { id: store.registerPath(p), path: p, done: false };
    })();
    if (!item) return;
    if (item.done) break;
    try {
      const meta = await scanPhoto(item.path, item.id);
      batch.push(meta);
      if (batch.length >= BATCH) {
        send('scan-batch', { folder, photos: batch });
        batch = [];
      }
    } catch {
      /* 单个文件失败跳过 */
    }
  }
  if (batch.length) send('scan-batch', { folder, photos: batch });
  send('scan-done', { folder });
}

function beginScan(folder, paths) {
  const total = paths.length;
  const generation = ++scanToken;
  store.scan = { paths, index: 0, generation };
  scanStream(folder, generation); // 异步，后台继续
  return total;
}

// ── IPC（对应 Tauri 命令）──

ipcMain.handle('start-scan', async (_e, folder) => {
  const paths = listImagePaths(folder);
  const total = beginScan(folder, paths);
  return { folder, total };
});

ipcMain.handle('open-path', async (_e, p) => {
  const stat = fs.statSync(p);
  let folder;
  let target = null;
  if (stat.isDirectory()) {
    folder = p;
  } else if (stat.isFile()) {
    folder = path.dirname(p);
    target = p;
  } else {
    throw new Error('路径不存在');
  }
  const paths = listImagePaths(folder);
  const index = target ? Math.max(0, paths.findIndex((q) => q === target)) : 0;
  return { folder, index, total: paths.length };
});

ipcMain.handle('load-photo', async (_e, id) => {
  const p = store.path(id);
  if (!p) throw new Error(`未知 id: ${id}`);
  const { meta, jpeg, mp4 } = await fullMeta(p, id);
  store.insert(id, { jpeg, mp4 });
  return meta;
});

ipcMain.handle('pick-folder', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: '选择照片文件夹',
  });
  return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0];
});

// ── viewer:// 协议 ──
// /load/{id}/{jpeg|mp4}：图片字节；其余路径：生产构建产物（build/ 目录）。
// 这样前端整体走自定义协议（对应 Tauri 版架构），绝对路径 /_app/... 也能正常解析。
// 注意：protocol.handle 必须在 app ready 之后注册（需要 session）。

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
};

const BUILD_DIR = path.join(__dirname, '..', 'build');

function registerViewerProtocol() {
  protocol.handle('viewer', (req) => {
    try {
      const u = new URL(req.url);
      const pathname = decodeURIComponent(u.pathname);
      const segs = pathname.trim().split('/').filter(Boolean);

      // 图片字节：/load/{id}/{jpeg|mp4}
      if (segs[0] === 'load') {
        if (segs.length !== 3) return new Response('bad request', { status: 400 });
        const id = Number(segs[1]);
        if (!Number.isInteger(id) || id <= 0) return new Response('bad id', { status: 400 });
        const part = segs[2];
        const file = store.get(id);
        if (!file) return new Response('not found', { status: 404 });
        let bytes;
        let ctype;
        if (part === 'jpeg') {
          bytes = file.jpeg;
          ctype = 'image/jpeg';
        } else if (part === 'mp4') {
          if (!file.mp4) return new Response('not found', { status: 404 });
          bytes = file.mp4;
          ctype = 'video/mp4';
        } else {
          return new Response('bad part', { status: 400 });
        }
        return new Response(bytes, {
          headers: {
            'Content-Type': ctype,
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-store',
          },
        });
      }

      // 构建产物：viewer://local/... → build/...
      const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
      const filePath = path.normalize(path.join(BUILD_DIR, rel));
      if (!filePath.startsWith(BUILD_DIR)) return new Response('forbidden', { status: 403 });
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        return new Response('not found', { status: 404 });
      }
      const ext = path.extname(filePath).toLowerCase();
      return new Response(fs.readFileSync(filePath), {
        headers: { 'Content-Type': MIME[ext] || 'application/octet-stream' },
      });
    } catch {
      return new Response('error', { status: 500 });
    }
  });
}

// ── 窗口 ──

function loadFrontend(win) {
  if (isDev) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL || 'http://localhost:1420');
  } else {
    // 加载根路径（协议映射到 index.html），避免 SvelteKit 把 /index.html 当路由 404
    win.loadURL('viewer://local/');
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 880,
    backgroundColor: '#121212',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.webContents.on('console-message', (...args) => {
    const d = args[1];
    console.log('[renderer]', typeof d === 'object' ? d.message : args[2]);
  });

  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('[main] renderer gone:', JSON.stringify(details));
  });

  loadFrontend(mainWindow);

  // 测试钩子：--open-path=<目录> 在加载后注入 lastFolder 并刷新，自动走打开流程
  let injectedOpenPath = false;
  if (openPathArg) {
    const folder = openPathArg.split('=').slice(1).join('=');
    mainWindow.webContents.on('did-finish-load', () => {
      if (injectedOpenPath) return;
      injectedOpenPath = true;
      mainWindow.webContents
        .executeJavaScript(`localStorage.setItem("lastFolder", ${JSON.stringify(folder)}); true`)
        .then(() => mainWindow.webContents.reload())
        .catch((e) => console.error('注入 lastFolder 失败:', e));
    });
  }

  // 截图调试模式：--screenshot=/abs/path/out.png
  let screenshotScheduled = false;
  if (screenshotArg) {
    mainWindow.webContents.on('did-finish-load', () => {
      if (screenshotScheduled) return;
      screenshotScheduled = true;
      // 等渲染完成（含扫描流式填充，多等一会儿）
      setTimeout(async () => {
        const img = await mainWindow.webContents.capturePage();
        const out = screenshotArg.split('=')[1];
        fs.writeFileSync(out, img.toPNG());
        try {
          const state = await mainWindow.webContents.executeJavaScript(`({
            title: document.title,
            photos: (document.querySelector('[data-testid=photos-count]') || {}).textContent || "",
            diag: (document.querySelector('[data-testid=diag]') || {}).textContent || "",
            bodyText: document.body.innerText.slice(0, 200)
          })`);
          fs.writeFileSync(out.replace(/\.png$/, '.json'), JSON.stringify(state, null, 2));
        } catch (e) {
          fs.writeFileSync(out.replace(/\.png$/, '.json'), JSON.stringify({ error: String(e) }));
        }
        app.exit(0);
      }, 12000);
    });
  }
}

app.whenReady().then(() => {
  registerViewerProtocol();
  createWindow();
  // 兜底：截图/测试场景强制退出，避免无头挂死
  if (screenshotArg) {
    setTimeout(() => {
      console.log('[main] 兜底退出（截图未完成）');
      app.exit(2);
    }, 45000);
  }
});

app.on('window-all-closed', () => {
  app.quit();
});
