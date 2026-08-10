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

// 待转发给渲染器的路径（右键"打开方式" / 拖拽 / 命令行传参），窗口就绪后发送
let pendingPath = null;

/** 从 argv 里挑出用户传的文件/文件夹（跳过可执行文件与标志位）。 */
function extractPathFromArgv(argv) {
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (!a || a.startsWith('-') || a === '.') continue;
    let stat = null;
    try {
      stat = fs.statSync(a);
    } catch {
      continue;
    }
    if (stat.isDirectory()) return a;
    if (stat.isFile() && isSupported(path.basename(a))) return a;
  }
  return null;
}

/** 把外部传入的路径交给渲染器打开（未就绪则排队）。 */
function sendOpenPath(p) {
  if (!p) return;
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isLoading()) {
    mainWindow.webContents.send('open-external-path', p);
  } else {
    pendingPath = p;
  }
}

// 单实例：再次启动（右键"打开方式"）时把参数交给已运行实例
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const p = extractPathFromArgv(argv);
    if (p) sendOpenPath(p);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
  // macOS：Finder "打开方式" / open 命令
  app.on('open-file', (e, p) => {
    e.preventDefault();
    sendOpenPath(p);
  });
}

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

/** 快速列表元数据：只从文件名/stat 得出，不做文件头读取（徽标稍后异步补齐）。 */
function quickMeta(p, id) {
  const name = path.basename(p);
  let size = 0;
  try {
    size = fs.statSync(p).size;
  } catch {}
  return {
    id,
    path: p,
    name,
    width: 0,
    height: 0,
    orientation: 1,
    // 文件名快速判定 Live（.live.jpeg 后缀）；精确判定（MotionPhoto 标记）由异步解析补齐
    is_live: /\.live\.jpeg$/i.test(name),
    mp4_offset: null,
    video_rotation: 0,
    size,
    date: null,
    ultra_hdr: null,
  };
}

/**
 * 列表阶段：分批推送文件名元数据（不读文件头，列表秒出）。
 * 结束后发 scan-done（前端据此把"正在扫描"关掉，徽标继续异步填充）。
 */
async function listStream(folder, generation) {
  const BATCH = 100;
  for (let i = 0; i < store.scan.paths.length; i += BATCH) {
    const s = store.scan;
    if (!s || s.generation !== generation) return;
    const metas = s.paths.slice(i, i + BATCH).map((p, j) => quickMeta(p, s.metaQueue[i + j]));
    s.listSentIndex = Math.max(s.listSentIndex, i + metas.length);
    send('scan-batch', { folder, photos: metas });
    if (i + BATCH < s.paths.length) await new Promise((r) => setImmediate(r));
  }
  send('scan-done', { folder });
}

/**
 * 徽标阶段：异步读文件头解析 HDR/Live 精判/尺寸/EXIF，scan-meta 逐批更新前端。
 * - 已解析过的（被 load_photo 全量解析过）跳过，不重复解析；
 * - 等待列表阶段先把该条目的快照发出去，避免 scan-meta 早于 scan-batch。
 */
async function metaStream(folder, generation) {
  const BATCH = 10;
  let batch = [];
  const flush = () => {
    if (batch.length) {
      send('scan-meta', { folder, photos: batch });
      batch = [];
    }
  };
  for (;;) {
    const s = store.scan;
    if (!s || s.generation !== generation) return;
    while (s.metaIndex < s.metaQueue.length && s.parsed.has(s.metaQueue[s.metaIndex])) s.metaIndex++;
    if (s.metaIndex >= s.metaQueue.length) {
      flush();
      // 队列空：空闲轮询等待动态新增的文件（或被新扫描替换时退出）
      await new Promise((r) => setTimeout(r, 200));
      continue;
    }
    // 等列表阶段已把该条目快照发出，避免 scan-meta 早于 scan-batch
    if (s.metaIndex >= s.listSentIndex) {
      await new Promise((r) => setTimeout(r, 20));
      continue;
    }
    const id = s.metaQueue[s.metaIndex];
    const p = store.path(id);
    if (!p) {
      s.metaIndex++;
      continue;
    }
    try {
      const meta = await scanPhoto(p, id);
      s.parsed.add(id);
      batch.push(meta);
      if (batch.length >= BATCH) flush();
    } catch {
      /* 单文件解析失败跳过 */
    }
    s.metaIndex++;
  }
}

function beginScan(folder, paths) {
  const total = paths.length;
  const generation = ++scanToken;
  // 同步注册所有 id（纯内存操作，快）；两阶段后台继续
  const ids = paths.map((p) => store.registerPath(p));
  store.scan = {
    folder,
    paths,
    generation,
    metaQueue: ids,
    metaIndex: 0,
    parsed: new Set(),
    listSentIndex: 0,
    idByPath: new Map(paths.map((p, i) => [p, ids[i]])),
  };
  listStream(folder, generation);
  metaStream(folder, generation);
  startFolderWatcher(folder, generation);
  return total;
}

// ── 文件夹监听：动态增删文件时更新列表 ──

let folderWatcher = null;

function closeWatcher() {
  if (folderWatcher) {
    try {
      folderWatcher.close();
    } catch {}
    folderWatcher = null;
  }
}

function startFolderWatcher(folder, generation) {
  closeWatcher();
  let timer = null;
  try {
    folderWatcher = fs.watch(folder, { persistent: false }, () => {
      // 防抖：保存/重命名会触发多次事件
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => reconcileFolder(folder, generation), 300);
    });
    folderWatcher.on("error", () => closeWatcher());
  } catch (e) {
    console.error("[watch] 无法监听文件夹:", e.message);
    folderWatcher = null;
  }
}

/** 重新列出文件夹，与当前列表 diff：新增推送 scan-batch(dynamic)，删除推送 scan-remove。 */
function reconcileFolder(folder, generation) {
  const s = store.scan;
  if (!s || s.generation !== generation || s.folder !== folder) return;
  let newPaths;
  try {
    newPaths = listImagePaths(folder);
  } catch {
    return; // 文件夹可能已被删除
  }
  const oldSet = new Set(s.paths);
  const newSet = new Set(newPaths);
  const added = newPaths.filter((p) => !oldSet.has(p));
  const removed = s.paths.filter((p) => !newSet.has(p));

  if (added.length) {
    const metas = added.map((p) => {
      const id = store.registerPath(p);
      s.metaQueue.push(id); // 加入徽标解析队列（metaStream 空闲轮询会接住）
      s.idByPath.set(p, id);
      return quickMeta(p, id);
    });
    s.listSentIndex = Math.max(s.listSentIndex, s.metaQueue.length);
    send("scan-batch", { folder, photos: metas, dynamic: true });
  }
  if (removed.length) {
    const ids = removed.map((p) => s.idByPath.get(p)).filter((id) => id != null);
    if (ids.length) send("scan-remove", { folder, ids });
  }
  s.paths = newPaths;
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
  // 已全量解析过 → 徽标阶段跳过，不重复解析
  if (store.scan) store.scan.parsed.add(id);
  return meta;
});

// 优先解析指定 id 的徽标（用户选中某张很远的图时，把它排到徽标队列最前）
ipcMain.handle('prioritize-scan', (_e, id) => {
  const s = store.scan;
  if (!s || !Number.isInteger(id) || s.parsed.has(id)) return;
  const idx = s.metaQueue.indexOf(id);
  if (idx > s.metaIndex) {
    s.metaQueue.splice(idx, 1);
    s.metaQueue.splice(s.metaIndex, 0, id);
  }
});

ipcMain.handle('pick-folder', async () => {
  const r = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: '选择照片文件夹',
  });
  return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0];
});

// 渲染器就绪后主动拉取排队的外部路径（避免 did-finish-load 事件时序竞态）
ipcMain.handle('get-pending-open-path', () => {
  const p = pendingPath;
  pendingPath = null;
  return p;
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

  // 防御：拖入文件被 Chromium 当作导航时阻止（应走 openPath 处理）
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith('file:') || url.startsWith('viewer://local/load/')) {
      e.preventDefault();
    }
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
            bodyText: document.body.innerText.slice(0, 1500)
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
  // 首次启动带文件参数（右键"打开方式" / 命令行传参）
  const argvPath = extractPathFromArgv(process.argv);
  if (argvPath) pendingPath = argvPath;
  // 兜底：截图/测试场景强制退出，避免无头挂死
  if (screenshotArg) {
    setTimeout(() => {
      console.log('[main] 兜底退出（截图未完成）');
      app.exit(2);
    }, 45000);
  }
});

app.on('window-all-closed', () => {
  closeWatcher();
  app.quit();
});
