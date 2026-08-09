<script lang="ts">
  import type { PhotoMeta } from "$lib/types";
  import { app } from "$lib/state.svelte";
  import { APP_COMMIT } from "$lib/version";

  interface Props {
    photo: PhotoMeta | null;
    videoUrl: string | null;
    videoError: boolean;
    videoEnded: boolean;
    videoEl: HTMLVideoElement | null;
    imgLoaded: boolean;
    imgError: boolean;
  }
  let {
    photo,
    videoUrl,
    videoError,
    videoEnded,
    videoEl,
    imgLoaded,
    imgError,
  }: Props = $props();

  let hdr = $state(false);
  let p3 = $state(false);
  $effect(() => {
    if (typeof matchMedia === "undefined") return;
    const mqHdr = matchMedia("(dynamic-range: high)");
    const mqP3 = matchMedia("(color-gamut: p3)");
    const update = () => {
      hdr = mqHdr.matches;
      p3 = mqP3.matches;
    };
    update();
    mqHdr.addEventListener("change", update);
    mqP3.addEventListener("change", update);
    return () => {
      mqHdr.removeEventListener("change", update);
      mqP3.removeEventListener("change", update);
    };
  });
  const hevc = $derived(
    videoEl
      ? videoEl.canPlayType('video/mp4; codecs="hvc1.1.6.L93.B0"')
      : "（无视频元素）",
  );
  const hev1 = $derived(
    videoEl
      ? videoEl.canPlayType('video/mp4; codecs="hev1.1.6.L93.B0"')
      : "（无视频元素）",
  );
  const avc = $derived(
    videoEl ? videoEl.canPlayType('video/mp4; codecs="avc1.42E01E"') : "（无视频元素）",
  );

  // 实时读取播放状态（currentTime 是 DOM 属性，不触发重渲染，必须用 timeupdate 驱动）
  let vNow = $state(0);
  let vReady = $state(0);
  let vPaused = $state(true);
  $effect(() => {
    const v = videoEl;
    if (!v) {
      vNow = 0;
      vReady = 0;
      vPaused = true;
      return;
    }
    const update = () => {
      vNow = v.currentTime;
      vReady = v.readyState;
      vPaused = v.paused;
    };
    update();
    v.addEventListener("timeupdate", update);
    v.addEventListener("play", update);
    v.addEventListener("pause", update);
    v.addEventListener("loadedmetadata", update);
    v.addEventListener("ended", update);
    return () => {
      v.removeEventListener("timeupdate", update);
      v.removeEventListener("play", update);
      v.removeEventListener("pause", update);
      v.removeEventListener("loadedmetadata", update);
      v.removeEventListener("ended", update);
    };
  });

  function buildInfo(): string {
    const lines = [
      `版本(commit): ${APP_COMMIT}`,
      `平台: ${navigator.userAgent}`,
      `HDR 屏(dynamic-range): ${hdr ? "是" : "否"}`,
      `广色域(p3): ${p3 ? "是" : "否"}`,
      `当前图片: ${photo?.name ?? "无"}`,
      `is_live: ${photo?.is_live}`,
      `video_rotation: ${photo?.video_rotation ?? "—"}`,
      `ultra_hdr: ${photo?.ultra_hdr ? JSON.stringify(photo.ultra_hdr) : "无"}`,
      `视频 URL: ${videoUrl ? "已设置" : "未设置"}`,
      `视频错误: ${videoError}`,
      `视频已结束: ${videoEnded}`,
      `HEVC 支持(hvc1.1.6): ${hevc}`,
      `HEVC 支持(hev1.1.6): ${hev1}`,
      `H.264 支持(avc1): ${avc}`,
      `视频尺寸: ${videoEl ? videoEl.videoWidth + " × " + videoEl.videoHeight : "无视频元素"}`,
      `视频状态: ${videoEl
        ? `readyState=${vReady} currentTime=${vNow.toFixed(2)} paused=${vPaused} 错误=${videoEl.error ? videoEl.error.code : "无"}`
        : "无视频元素"}`,
      `已起播: ${vNow > 0 ? "是" : "否"}`,
      `图片已加载: ${imgLoaded}`,
      `图片错误: ${imgError}`,
    ];
    return lines.join("\n");
  }

  let copied = $state(false);
  async function copyAll() {
    try {
      await navigator.clipboard.writeText(buildInfo());
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch {
      /* 剪贴板不可用时忽略 */
    }
  }
</script>

<div
  class="diag"
  role="dialog"
  tabindex="-1"
  aria-label="诊断信息"
  onclick={(e) => e.stopPropagation()}
  onkeydown={(e) => e.stopPropagation()}
>
  <div class="diag-head">
    <span>诊断信息</span>
    <div class="head-actions">
      <button class="copy" onclick={copyAll}>{copied ? "已复制 ✓" : "复制"}</button>
      <button class="close" onclick={() => (app.showDiag = false)}>×</button>
    </div>
  </div>
  <table>
    <tbody>
      <tr><th>版本 (commit)</th><td>{APP_COMMIT}</td></tr>
      <tr><th>平台</th><td>{navigator.userAgent.slice(0, 90)}</td></tr>
      <tr><th>HDR 屏 (dynamic-range)</th><td>{hdr ? "是 ✅" : "否 ❌"}</td></tr>
      <tr><th>广色域 (color-gamut p3)</th><td>{p3 ? "是" : "否"}</td></tr>
      <tr><th>当前图片</th><td>{photo?.name ?? "无"}</td></tr>
      <tr><th>is_live</th><td>{String(photo?.is_live)}</td></tr>
      <tr><th>video_rotation</th><td>{photo?.video_rotation ?? "—"}</td></tr>
      <tr><th>ultra_hdr</th><td>{photo?.ultra_hdr ? JSON.stringify(photo.ultra_hdr) : "无"}</td></tr>
      <tr><th>视频 URL</th><td>{videoUrl ? "已设置" : "未设置"}</td></tr>
      <tr><th>视频错误</th><td>{String(videoError)}</td></tr>
      <tr><th>视频已结束</th><td>{String(videoEnded)}</td></tr>
      <tr><th>HEVC 支持 (hvc1.1.6)</th><td>{hevc}</td></tr>
      <tr><th>HEVC 支持 (hev1.1.6)</th><td>{hev1}</td></tr>
      <tr><th>H.264 支持 (avc1)</th><td>{avc}</td></tr>
      <tr><th>视频尺寸</th><td>{videoEl ? videoEl.videoWidth + " × " + videoEl.videoHeight : "无视频元素"}</td></tr>
      <tr><th>视频状态</th><td>{videoEl ? `readyState=${vReady} currentTime=${vNow.toFixed(2)} paused=${vPaused} 错误=${videoEl.error ? videoEl.error.code : "无"}` : "无视频元素"}</td></tr>
      <tr><th>已起播</th><td>{vNow > 0 ? "是" : "否"}</td></tr>
      <tr><th>图片已加载</th><td>{String(imgLoaded)}</td></tr>
      <tr><th>图片错误</th><td>{String(imgError)}</td></tr>
    </tbody>
  </table>
  <p class="hint">
    请把这份信息发给我。HDR 屏 ❌ = WebView2 未启用 HDR 输出；HEVC 支持为空 = 无法播放 HEVC 视频。
  </p>
</div>

<style>
  .diag {
    position: absolute;
    top: 12px;
    right: 12px;
    z-index: 30;
    width: 360px;
    max-height: 80%;
    overflow: auto;
    background: rgba(18, 20, 24, 0.95);
    border: 1px solid #2a2d33;
    border-radius: 10px;
    padding: 10px 12px;
    font-size: 11.5px;
    backdrop-filter: blur(8px);
    user-select: text;
  }

  .diag-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-weight: 700;
    color: #e8e8e8;
    margin-bottom: 8px;
  }

  .head-actions {
    display: flex;
    gap: 6px;
    align-items: center;
  }

  .copy {
    border: 1px solid #34373d;
    background: #23252b;
    color: #c9cdd4;
    border-radius: 6px;
    padding: 2px 10px;
    font-size: 12px;
    cursor: pointer;
  }
  .copy:hover {
    background: #2c2f36;
  }

  .close {
    border: none;
    background: transparent;
    color: #8a8f98;
    font-size: 16px;
    cursor: pointer;
  }
  .close:hover {
    color: #fff;
  }

  table {
    width: 100%;
    border-collapse: collapse;
  }
  th {
    text-align: left;
    color: #8a8f98;
    font-weight: 500;
    padding: 3px 6px 3px 0;
    white-space: nowrap;
    vertical-align: top;
  }
  td {
    color: #d8dae0;
    padding: 3px 0;
    word-break: break-all;
  }

  .hint {
    margin: 8px 0 0;
    color: #5a5e66;
  }
</style>
