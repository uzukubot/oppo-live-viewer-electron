const { app, BrowserWindow, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

// 自定义 viewer:// 协议：从 assets/ 提供字节（对应 Tauri 版 viewer:// 的角色）。
// 渲染器用 fetch 取字节再生成 blob URL，绕开 file:// scheme 下 fetch 的限制。
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'viewer',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true }
  }
]);

// ── HDR 相关启动参数（默认都注释掉，先与 Chrome 默认行为保持一致，便于对比）──

// Windows 新 Chromium（142+，Electron 39+）默认把 HDR 内容按"系统 SDR 亮度滑块"tone-map，
// 与 Chrome 行为一致。若实测想对比"绝对 HDR"（不受 SDR 滑块影响），放开下一行：
// app.commandLine.appendSwitch('disable-features', 'HlgPqSdrRelative');

// Live 视频（HEVC/H.265）：Electron 官方 ffmpeg 不含 H.265，走平台硬件解码。
// Windows 依赖系统 HEVC 解码器（与 WebView2 现状相同）；macOS 走 VideoToolbox 原生支持。
app.commandLine.appendSwitch('enable-features', 'PlatformHEVCDecoderSupport');

// 截图调试模式：electron . --screenshot=/abs/path/out.png （无头/CI 冒烟测试用）
const screenshotArg = process.argv.find((a) => a.startsWith('--screenshot='));

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 880,
    backgroundColor: '#131313',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // 把渲染器 console 转发到终端，方便排查
  mainWindow.webContents.on('console-message', (...args) => {
    // 旧签名 (event, level, message, ...)；新签名 (event, details)
    const d = args[1];
    console.log('[renderer]', typeof d === 'object' ? d.message : args[2]);
  });

  if (screenshotArg) {
    mainWindow.webContents.on('did-finish-load', () => {
      // 等渲染器完成图片解码 + 诊断绘制后再截图（16MB 样本解码较慢，等 8s）
      setTimeout(async () => {
        const img = await mainWindow.webContents.capturePage();
        const out = screenshotArg.split('=')[1];
        fs.writeFileSync(out, img.toPNG());
        // 导出渲染状态，便于无头排查
        try {
          const state = await mainWindow.webContents.executeJavaScript(`({
            ready: document.readyState,
            vElectron: document.getElementById('vElectron').textContent,
            vChrome: document.getElementById('vChrome').textContent,
            vDynamicRange: document.getElementById('vDynamicRange').textContent,
            vGainmap: document.getElementById('vGainmap').textContent,
            hdrComplete: document.getElementById('imgHdr').complete,
            hdrSize: document.getElementById('imgHdr').naturalWidth + 'x' + document.getElementById('imgHdr').naturalHeight,
            sdrSize: document.getElementById('imgSdr').naturalWidth + 'x' + document.getElementById('imgSdr').naturalHeight,
            liveHidden: document.getElementById('live').hidden,
            vVideo: document.getElementById('vVideo').textContent,
            videoState: document.getElementById('video').readyState,
            videoErr: document.getElementById('video').error ? document.getElementById('video').error.code : null
          })`);
          fs.writeFileSync(out.replace(/\.png$/, '.json'), JSON.stringify(state, null, 2));
        } catch (e) {
          fs.writeFileSync(out.replace(/\.png$/, '.json'), JSON.stringify({ error: String(e) }));
        }
        app.exit(0);
      }, 8000);
    });
  }
}

app.whenReady().then(() => {
  // viewer://local/<文件名> → assets/ 下的文件（直接读字节，避免 net.fetch(file:) 的坑）
  protocol.handle('viewer', async (req) => {
    try {
      const name = path.basename(decodeURIComponent(new URL(req.url).pathname));
      const file = path.join(__dirname, 'assets', name);
      const buf = await fs.promises.readFile(file);
      const mime = name.endsWith('.jpeg') || name.endsWith('.jpg') ? 'image/jpeg' : 'application/octet-stream';
      return new Response(buf, { headers: { 'Content-Type': mime } });
    } catch (err) {
      console.error('[viewer] 读取失败:', err.message);
      return new Response('not found', { status: 404 });
    }
  });
  createWindow();
});

app.on('window-all-closed', () => {
  app.quit();
});
