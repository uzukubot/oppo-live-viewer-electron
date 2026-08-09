# OPPO Live Viewer — Electron 版

OPPO Live Photo / Ultra HDR 查看器。**Electron 自带完整 Chromium，能在 HDR 屏上输出真 HDR**
（gain map 图片按 HDR 渲染，与 Chrome 一致）——这是对 Tauri 版（嵌入式 WebView 无法输出真 HDR）
的核心升级。前端为 Svelte 5，从原 Tauri 版直接复用。

## 功能

- **Ultra HDR 静态图**：完整 JPEG（含 gain map）交给 Chromium 原生解码；SDR 屏只显示基础图（与 Chrome 一致），HDR 屏显示真 HDR。
- **Live Photo**：`.live.jpeg` 切分为 JPEG + 内嵌 HEVC MP4，视频走平台解码（Windows 依赖系统 HEVC 解码器，macOS VideoToolbox 原生）。
- 流式扫描大文件夹：立即出列表、边扫边追加（每批 25 张）。
- 文件名列表 / 缩略图网格、搜索、缩放/平移、滚轮翻页、拖拽打开、F12 诊断面板。

## 架构

```
Svelte5 前端（复用自 Tauri 版，双栏布局）
  │ window.api（preload contextBridge）· fetch viewer:// 字节
  ▼
Electron 主进程（electron/）
  · main.cjs    窗口 + IPC（start-scan / open-path / load-photo / pick-folder）
                 + viewer:// 协议（/load/{id}/{jpeg|mp4} 供字节 + 生产构建产物）
                 + 流式扫描（scan-batch / scan-done 事件，代际停止旧扫描）
  · parser.cjs  parser.rs 移植：容器切分 / EXIF / 尺寸 / Ultra HDR 检测 / 视频旋转角
  · store.cjs   store.rs 移植：id→路径 + 字节 LRU 缓存(24) + 扫描状态
  · preload.cjs contextBridge 暴露 window.api
```

像素级工作全部交给 Chromium（不自己解码），与 Tauri 版设计一致。

## 本地开发

```bash
npm install
npm run dev        # vite dev(1420) + electron --dev
```

## 构建 Windows portable（CI）

推送 `main` 触发 GitHub Actions，产出单文件 portable exe 上传到 Actions Artifacts。

```bash
npm run build      # 构建前端到 build/
npm run dist:win   # build + electron-builder --win portable
```

## 后端自测

```bash
npm run selftest   # 用真实 .live.jpeg / Ultra HDR 照片验证 parser（无 GUI）
```

## 已知注意点

- **自定义协议 fetch 后要用 `arrayBuffer()`，不要用 `blob()`**：Electron 自定义协议
  （`protocol.handle` + `supportFetchAPI`）下 `response.blob()` 报 `Failed to fetch`，`arrayBuffer()` 正常。
- **`protocol.handle` 必须在 `app.whenReady()` 之后注册**（需要 session）。
- **生产前端从 `viewer://local/` 加载**（协议服务 build/），不是 `loadFile`：SvelteKit 的绝对路径
  `/_app/...` 与 SPA 路由在 file:// 下都会出问题。
- **HEVC**：`main.js` 已启用 `PlatformHEVCDecoderSupport` 走平台硬件解码；Windows 依赖系统 HEVC
  解码器（与 WebView2 现状相同），macOS 原生。Linux 无平台 HEVC 路径，视频不播属预期。
- **Windows HDR tone-map**：新 Chromium 默认按系统 SDR 亮度滑块映射（与 Chrome 一致）；
  需绝对 HDR 可放开 `electron/main.cjs` 里的 `--disable-features=HlgPqSdrRelative`。
- `dynamic-range: high` 媒体查询在**两个方向都不可靠**（WebView2 查询"是"不出 HDR；Electron 实测
  查询"否"但真出 HDR）。判据是与 Chrome 同屏对比高光。
- 测试数据不入库，仓库保持小体积；本地验证用自己的 `.live.jpeg` / Ultra HDR 照片。

## 参考

- 原 Tauri 版：https://github.com/uzukubot/oppo-live-viewer-tauri
  （`docs/KNOWN_ISSUES.md` §1 记录了 WebView2 无法输出真 HDR 的诊断；本仓库即该结论的落地方案）
- HDR 验证原型：2026-08-10 在用户 HDR Windows 实机确认真 HDR 生效（高光与 Chrome 一致、P3 探针更亮）。
