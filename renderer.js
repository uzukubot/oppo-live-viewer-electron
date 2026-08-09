const $ = (id) => document.getElementById(id);

function fillVersions() {
  const e = window.env || {};
  $('vElectron').textContent = e.electron || '?';
  $('vChrome').textContent = e.chrome || '?';
}

function fillMediaQueries() {
  $('vDynamicRange').textContent = matchMedia('(dynamic-range: high)').matches ? '是' : '否';
  $('vP3').textContent = matchMedia('(color-gamut: p3)').matches ? '是' : '否';
}

// 扫描字节：gain map（hdrgm / GainMap）与 Live 视频 box（ftypmp42 / ftypisom）
function scanBytes(buf) {
  // 整个 buffer 一次性解码成 latin1 字符串（16MB 也就几十 ms），再用 indexOf 定位
  const s = new TextDecoder('latin1').decode(buf);
  const gain = `${s.includes('hdrgm') ? 'hdrgm ✓' : 'hdrgm ✗'} / ${s.includes('GainMap') ? 'GainMap ✓' : 'GainMap ✗'}`;
  let ftyp = buf.length;
  for (const sig of ['ftypmp42', 'ftypisom', 'ftypiso5']) {
    const i = s.indexOf(sig);
    if (i >= 0 && i < ftyp) ftyp = i;
  }
  const hasVideo = ftyp < buf.length;
  return { gain, ftyp, hasVideo };
}

// 用 createImageBitmap 取 SDR 基础图（gain map 只在合成层生效，bitmap 解码得到的是基础图）
async function buildSdrBase(blob) {
  const bmp = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = canvas.getContext('2d'); // 默认 sRGB
  ctx.drawImage(bmp, 0, 0);
  return canvas.convertToBlob({ type: 'image/png' });
}

function stopVideo() {
  const v = $('video');
  v.pause();
  v.removeAttribute('src');
  v.load();
}

function setupVideo(mp4Blob) {
  $('live').hidden = false;
  $('vVideo').textContent = `HEVC MP4 ${(mp4Blob.size / 1024 / 1024).toFixed(1)}MB，尝试平台解码…`;
  const v = $('video');
  v.src = URL.createObjectURL(mp4Blob);
  v.muted = true; // 恒静音起播，绕过 autoplay 策略
  v.onerror = () => { $('vVideo').textContent = '无法播放（平台缺少 HEVC 解码器时在 Windows 属预期，macOS 应原生可播）'; };
  v.onloadedmetadata = () => { $('vVideo').textContent = `可播放 · ${v.videoWidth}x${v.videoHeight}`; };
  v.play().catch(() => { /* 被策略拦截时保留可点击播放 */ });
}

async function show(blob) {
  stopVideo();
  $('live').hidden = true;

  try {
    const buf = new Uint8Array(await blob.arrayBuffer());
    const { gain, ftyp, hasVideo } = scanBytes(buf);
    $('vGainmap').textContent = gain;

    if (hasVideo) {
      // Live Photo：box 前 4 字节是 box 长度，ftyp 之前即 JPEG(含 gain map)，之后为 HEVC MP4
      const boxStart = ftyp - 4;
      const jpegBlob = blob.slice(0, Math.max(boxStart, 0));
      const mp4Blob = blob.slice(Math.max(boxStart, 0));
      $('imgHdr').src = URL.createObjectURL(jpegBlob);
      $('imgSdr').src = URL.createObjectURL(await buildSdrBase(jpegBlob));
      setupVideo(mp4Blob);
    } else {
      $('imgHdr').src = URL.createObjectURL(blob);
      $('imgSdr').src = URL.createObjectURL(await buildSdrBase(blob));
    }
  } catch (err) {
    console.error('show() failed:', err);
    $('vGainmap').textContent = '处理失败: ' + err.message;
  }
}

fillVersions();
fillMediaQueries();

// 默认不加载内置样本（测试数据不入库，仓库保持小体积），由用户点"打开图片"加载。
// 若本机 assets/ 下放了自己的样本，也可用 viewer://local/<文件名> 经主进程协议加载：
// fetch('viewer://local/<文件名>').then(r => r.arrayBuffer()).then(ab => show(new Blob([ab])))

$('openBtn').addEventListener('click', () => $('fileInput').click());
$('fileInput').addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (f) show(f);
});
