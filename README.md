# OPPO Live Viewer — Electron HDR 验证原型

最小 Electron 原型，用来验证一个关键结论：**Tauri 的嵌入式 WebView（Windows WebView2 /
macOS WKWebView）合成层不声明 HDR 内容支持，gain map 只按 SDR 解码；而 Electron 自带完整
Chromium，理论上和 Chrome 一样能在 HDR 屏上输出真 HDR（Ultra HDR / gain map）。**

本原型只做一件事：在窗口里并排显示一张 Ultra HDR 图片的 **SDR 基础图** 与 **HDR 原图**，
并提供诊断信息，供在真实 HDR 屏上肉眼/截图对比验证。

## 怎么看结果

- `dynamic-range: high` = 是 且 `color-gamut: p3` = 是：系统认为屏幕是 HDR。
  **注意**：媒体查询在**两个方向都不可靠**——WebView2 是查询"是"但不出 HDR；本次 Electron
  实测查询"否"但实际输出 HDR。真正的判据是下面的左右对比 + 宽色域探针。
- 宽色域探针：HDR 屏上右侧 display-p3 纯红应明显比左侧 sRGB 纯红更亮更艳。
- 核心验证：**右侧 HDR 原图** 与 **左侧 SDR 基础图** 对比。
  - 真 HDR 生效：右侧高光明显更亮（如天空/灯/反射更"炸"），且与 Chrome 打开同一文件一致。
  - 未生效：两侧几乎一样（等同 Tauri 现状）。
- 测试数据不入库（仓库保持小体积）：点"打开 Ultra HDR 图片…"加载你自己的
  `.live.jpeg` / Ultra HDR 照片。本机可在 `assets/` 放样本后经 `viewer://local/<文件名>` 加载。

## 验证结果（2026-08-10，用户 HDR Windows 实机）

✅ **真 HDR 生效**：
- 右侧 HDR 原图高光明显比左侧 SDR 基础图更亮，且与 Chrome 打开同一文件基本一致；
- display-p3 纯红探针明显比 sRGB 更亮；
- 即使 `dynamic-range: high` / `color-gamut: p3` 媒体查询返回"否"（见上），实际输出仍是 HDR。

**结论**：Electron（自带 Chromium）确实能输出真 HDR，Tauri WebView 的 HDR 限制可以靠换壳 Electron 解决。

## 本地运行

```bash
npm install
npm start
```

## 构建 Windows portable（CI）

推送 `main` 即触发 GitHub Actions，产出单文件 portable exe 上传到 Actions Artifacts：

```bash
npm run dist:win
```

## 已知注意点

- **HEVC Live 视频**：Electron 官方 ffmpeg 不含 H.265，`main.js` 已启用
  `PlatformHEVCDecoderSupport` 走平台硬件解码（Windows 依赖系统 HEVC 解码器，与 WebView2 现状
  相同；macOS VideoToolbox 原生）。Linux 无平台 HEVC 路径，视频无法播放属预期。
- **Windows HDR tone-map**：新 Chromium 默认把 HDR 内容按系统 SDR 亮度滑块映射，与 Chrome 一致；
  如需绝对 HDR 可放开 `main.js` 里的 `--disable-features=HlgPqSdrRelative`。
- `dynamic-range: high` 媒体查询为真 ≠ 合成层能输出 HDR（这正是 WebView2 的坑）。
  本原型的左右对比 + 宽色域探针才是客观判据。
- **自定义协议 fetch 后要用 `arrayBuffer()`，不要用 `blob()`**：Electron 自定义协议
  （`protocol.handle` + `supportFetchAPI`）下 `response.blob()` 会报 `Failed to fetch`，
  `arrayBuffer()` 正常。真实 App 的字节加载层需注意这一点。

## 参考

- 原 Tauri 版项目：[oppo-live-viewer-tauri](https://github.com/uzukubot/oppo-live-viewer-tauri)
  （`docs/KNOWN_ISSUES.md` §1 记录了 WebView2 无法输出真 HDR 的完整诊断与结论）
