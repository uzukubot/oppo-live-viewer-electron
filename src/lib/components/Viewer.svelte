<script lang="ts">
  import { onMount } from "svelte";
  import { app, next, prev } from "$lib/state.svelte";
  import { displayDims } from "$lib/types";
  import type { PhotoMeta } from "$lib/types";
  import { photoCache } from "$lib/viewer/photoCache";
  import Diagnostics from "./Diagnostics.svelte";

  const photo = $derived(app.photos[app.index] ?? null);

  let stage: HTMLDivElement;
  let cssW = $state(0);
  let cssH = $state(0);
  let dpr = $state(1);
  let zoom = $state(1);
  let pan = $state({ x: 0, y: 0 });
  let dragging = $state(false);
  let lastPoint = $state({ x: 0, y: 0 });
  let imgSrc = $state<string | null>(null);
  let imgLoaded = $state(false);
  let imgError = $state(false);

  // 视频
  let videoUrl = $state<string | null>(null);
  let videoError = $state(false);
  let videoDims = $state<{ w: number; h: number } | null>(null);
  let videoEl = $state<HTMLVideoElement | null>(null);
  let videoEnded = $state(false);
  /** 是否正在播放（默认不自动播放，先显示 HDR 封面；视频是 SDR，避免盖住封面）。 */
  let videoPlaying = $state(false);
  /** 自动播放被浏览器策略拦截（视频仍在，等待点击播放）。 */
  let videoBlocked = $state(false);
  let playMode = $state<"once" | "loop">("once");
  let muted = $state(true);

  function clamp(v: number, lo: number, hi: number) {
    return Math.min(hi, Math.max(lo, v));
  }

  // 适应窗口的布局（未应用 EXIF 旋转后的展示尺寸）
  const fit = $derived.by(() => {
    if (!photo) return null;
    const { w: iw, h: ih } = displayDims(photo);
    if (iw <= 0 || ih <= 0) return null;
    const scale = Math.min(cssW / iw, cssH / ih);
    return { iw, ih, scale };
  });

  // <img> 的尺寸与位置：交给浏览器原生解码（ICC 色彩/EXIF 方向/缩放质量）。
  // 注：WebView2 合成层不输出真 HDR，HDR 屏上显示的仍是 SDR 基础图（见 KNOWN_ISSUES）
  const imgStyle = $derived.by(() => {
    if (!fit) return null;
    const s = fit.scale * zoom;
    const w = fit.iw * s;
    const h = fit.ih * s;
    return `width:${w}px;height:${h}px;left:${(cssW - w) / 2 + pan.x}px;top:${(cssH - h) / 2 + pan.y}px;`;
  });

  // 切换照片（按 id）时重置视图与视频状态；load_photo 回写元数据（同 id）不重置
  let lastPhotoId: number | null = null;
  $effect(() => {
    const p = photo;
    void p;
    if (p?.id !== lastPhotoId) {
      lastPhotoId = p?.id ?? null;
      zoom = 1;
      pan = { x: 0, y: 0 };
      imgSrc = null;
      imgLoaded = false;
      imgError = false;
      // 切换前先静音+暂停旧视频
      if (videoEl) {
        videoEl.muted = true;
        videoEl.pause();
      }
      videoUrl = null;
      videoError = false;
      videoDims = null;
      videoEnded = false;
      videoPlaying = false;
      videoBlocked = false;
    }
    if (p) {
      const pid = p.id;
      // 先 load_photo 预热缓存、fetch 字节生成 objectURL，再渲染 <img>（避免 404 竞态）
      photoCache
        .ensureJpegUrl(p)
        .then((u) => {
          if (photo?.id === pid) {
            imgSrc = u;
            imgError = false;
          }
        })
        .catch(() => {
          if (photo?.id === pid) imgError = true;
        });
    }
    if (p?.is_live) {
      const pid = p.id;
      photoCache.ensureMp4Url(p).then((u) => {
        if (u && photo?.id === pid) videoUrl = u;
      });
    }
    // 预取相邻照片，快速翻看
    photoCache.prefetchNearby(app.photos, app.index, 2);
  });

  function retryImg() {
    if (!photo) return;
    const pid = photo.id;
    imgError = false;
    imgSrc = null;
    photoCache
      .ensureJpegUrl(photo)
      .then((u) => {
        if (photo?.id === pid) imgSrc = u;
      })
      .catch(() => {
        if (photo?.id === pid) imgError = true;
      });
  }

  function measure() {
    if (!stage) return;
    const rect = stage.getBoundingClientRect();
    cssW = rect.width;
    cssH = rect.height;
    dpr = window.devicePixelRatio || 1;
  }

  onMount(() => {
    const ro = new ResizeObserver(measure);
    ro.observe(stage);
    measure();
    return () => ro.disconnect();
  });

  function zoomAt(factor: number, cx: number, cy: number) {
    if (!photo || !fit) return;
    const oldScale = fit.scale * zoom;
    const newZoom = clamp(zoom * factor, 1, 64);
    const newScale = fit.scale * newZoom;
    // 保持光标下的图像点不动
    const ox = (cssW - fit.iw * oldScale) / 2 + pan.x;
    const oy = (cssH - fit.ih * oldScale) / 2 + pan.y;
    const relX = (cx - ox) / oldScale;
    const relY = (cy - oy) / oldScale;
    const nx = (cssW - fit.iw * newScale) / 2;
    const ny = (cssH - fit.ih * newScale) / 2;
    zoom = newZoom;
    pan = {
      x: cx - nx - relX * newScale,
      y: cy - ny - relY * newScale,
    };
    clampPan(newScale);
  }

  function clampPan(scale?: number) {
    if (!photo || !fit) return;
    const s = scale ?? fit.scale * zoom;
    const dw = fit.iw * s;
    const dh = fit.ih * s;
    const maxX = Math.max(0, (dw - cssW) / 2);
    const maxY = Math.max(0, (dh - cssH) / 2);
    pan = {
      x: clamp(pan.x, -maxX - cssW * 0.15, maxX + cssW * 0.15),
      y: clamp(pan.y, -maxY - cssH * 0.15, maxY + cssH * 0.15),
    };
  }

  function toggleZoom() {
    if (!photo || !fit) return;
    if (zoom <= 1.001) {
      zoom = clamp(1 / (dpr * fit.scale), 1, 64);
      pan = { x: 0, y: 0 };
    } else {
      zoom = 1;
      pan = { x: 0, y: 0 };
    }
  }

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    const rect = stage.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    if (e.ctrlKey || e.shiftKey) {
      zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, cx, cy);
    } else {
      if (e.deltaY > 0) next();
      else prev();
    }
  }

  function onPointerDown(e: PointerEvent) {
    if (zoom <= 1.001) return;
    // 点按按钮/视频控件时不要启动拖拽（否则 setPointerCapture 会吞掉按钮 click）；
    // 视频区域本身允许拖拽（放大后拖动视频平移）
    const el = e.target as HTMLElement;
    if (el.closest("button") || el.closest(".video-controls")) return;
    dragging = true;
    lastPoint = { x: e.clientX, y: e.clientY };
    stage.setPointerCapture(e.pointerId);
  }
  function onPointerMove(e: PointerEvent) {
    if (!dragging) return;
    pan = {
      x: pan.x + (e.clientX - lastPoint.x),
      y: pan.y + (e.clientY - lastPoint.y),
    };
    lastPoint = { x: e.clientX, y: e.clientY };
    clampPan();
  }
  function onPointerUp() {
    dragging = false;
  }

  // ---- 视频控制 ----
  /** 元数据就绪后只记录尺寸，不自动播放——先显示 HDR 封面，由用户点击播放。 */
  function onVideoMetadata() {
    if (!videoEl) return;
    videoDims = { w: videoEl.videoWidth, h: videoEl.videoHeight };
  }
  /** 先静音起播以兼容自动播放策略，播放真正开始后若用户有声则恢复。 */
  function tryPlay() {
    if (!videoEl) return;
    const el = videoEl;
    videoPlaying = true;
    videoEnded = false;
    const wantSound = !muted;
    el.muted = true;
    el.play()
      .then(() => {
        if (wantSound && el === videoEl && !muted) el.muted = false;
      })
      .catch(() => {
        // 播放被拦截：回到封面，显示"点击播放"
        videoPlaying = false;
        videoBlocked = true;
      });
  }
  function onVideoError() {
    videoError = true;
    videoPlaying = false;
  }
  /** 播一次：结束后回到封面图；循环模式：重新播放。 */
  function onVideoEnded() {
    if (playMode === "loop") {
      if (videoEl) {
        videoEl.currentTime = 0;
        videoEl.play().catch(() => {});
      }
    } else {
      videoEnded = true;
      videoPlaying = false;
    }
  }
  function replay() {
    if (!videoEl) return;
    videoEl.currentTime = 0;
    videoBlocked = false;
    tryPlay();
  }
  function toggleLoop() {
    playMode = playMode === "loop" ? "once" : "loop";
    if (playMode === "loop" && videoEnded) replay();
  }
  function toggleMute() {
    muted = !muted;
    // 只切换静音，不主动播放：视频播完后想听声音请点"重播"，否则会静音播放一帧
    if (videoEl) videoEl.muted = muted;
  }

  function videoLayout() {
    if (!videoDims) return null;
    let dw = videoDims.w;
    let dh = videoDims.h;
    if (dw <= 0 || dh <= 0) return null; // 元数据未就绪或解码失败
    const deg = photo?.video_rotation ?? 0;
    if (deg === 90 || deg === 270) {
      const t = dw;
      dw = dh;
      dh = t;
    }
    // 视频随图片一起缩放/平移（放大时视频也应跟随，否则像"从图片里伸出来"）
    const scale = Math.min(cssW / dw, cssH / dh) * zoom;
    const boxW = dw * scale;
    const boxH = dh * scale;
    const x = (cssW - boxW) / 2 + pan.x;
    const y = (cssH - boxH) / 2 + pan.y;
    if (deg === 90 || deg === 270) {
      return { x, y, boxW, boxH, vidW: boxH, vidH: boxW, deg };
    }
    return { x, y, boxW, boxH, vidW: boxW, vidH: boxH, deg };
  }

  const vl = $derived(videoLayout());
  const at100 = $derived(zoom > 1.001);
</script>

<div
  class="stage"
  bind:this={stage}
  onwheel={onWheel}
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  ondblclick={toggleZoom}
  role="application"
  aria-label="照片查看区域"
>
  {#if photo}
    {#if imgSrc}
      <img
        class="view-img"
        src={imgSrc}
        style={imgStyle}
        draggable="false"
        alt=""
        onload={() => (imgLoaded = true)}
        onerror={() => (imgError = true)}
      />
    {/if}
    {#if !imgLoaded && !imgError}
      <div class="loading">加载中…</div>
    {/if}
    {#if imgError}
      <div class="msg err">
        图片加载失败
        <button class="retry" onclick={retryImg}>重试</button>
      </div>
    {/if}
  {:else}
    <div class="msg">加载图片…</div>
  {/if}

  {#if videoUrl && !videoError}
    <div
      class="video-box"
      class:hidden={!vl || videoEnded || !videoPlaying}
      style={vl
        ? `left:${vl.x}px;top:${vl.y}px;width:${vl.boxW}px;height:${vl.boxH}px;`
        : ""}
      onclick={videoBlocked ? replay : undefined}
      onkeydown={(e) => {
        if (e.key === "Enter" && videoBlocked) replay();
      }}
      role="button"
      tabindex="-1"
    >
      <video
        bind:this={videoEl}
        src={videoUrl}
        muted={muted}
        playsinline
        onloadedmetadata={onVideoMetadata}
        onerror={onVideoError}
        onended={onVideoEnded}
        style={vl
          ? `width:${vl.vidW}px;height:${vl.vidH}px;transform:translate(-50%,-50%) rotate(${vl.deg}deg);`
          : "width:1px;height:1px;transform:translate(-50%,-50%);"}
      ></video>
      {#if videoBlocked}
        <div class="play-prompt">▶ 点击播放</div>
      {/if}
    </div>
  {/if}
  {#if photo?.is_live && videoUrl && !videoError && vl && !videoPlaying && !videoEnded}
    <div
      class="play-prompt cover"
      onclick={replay}
      onkeydown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          replay();
        }
      }}
      role="button"
      tabindex="0"
    >
      ▶ 播放 Live 视频
    </div>
  {/if}
  {#if photo?.is_live && videoError}
    <div class="msg err">Live 视频无法播放（可能缺少 HEVC 解码器）</div>
  {/if}

  <div class="badges">
    {#if photo?.is_live}
      <span class="badge live">LIVE</span>
    {/if}
    {#if photo?.ultra_hdr}
      <span class="badge hdr">HDR</span>
    {/if}
  </div>

  {#if photo?.is_live}
    <div class="video-controls">
      <button class="ctl" onclick={replay} title="从头播放一次">重播</button>
      <button
        class="ctl {playMode === 'loop' ? 'on' : ''}"
        onclick={toggleLoop}
        title="循环播放"
      >
        循环
      </button>
      <button
        class="ctl {muted ? 'on' : ''}"
        onclick={toggleMute}
        title="静音开关"
      >
        {muted ? "静音" : "有声"}
      </button>
    </div>
  {/if}

  {#if at100}
    <div class="zoom-hint">100%</div>
  {/if}

  {#if app.showDiag}
    <Diagnostics
      {photo}
      {videoUrl}
      {videoError}
      {videoEnded}
      {videoEl}
      {imgLoaded}
      {imgError}
    />
  {/if}
</div>

<style>
  .stage {
    position: relative;
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    background:
      radial-gradient(circle at 50% 40%, #1a1a1a 0%, #0c0c0c 100%);
    user-select: none;
    touch-action: none;
  }

  .view-img {
    position: absolute;
    display: block;
    user-select: none;
    -webkit-user-drag: none;
  }

  .loading,
  .msg {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    color: #8a8f98;
    font-size: 13px;
  }
  .msg.err {
    color: #f08787;
  }

  .retry {
    margin-left: 10px;
    border: 1px solid #34373d;
    background: #23252b;
    color: #c9cdd4;
    border-radius: 6px;
    padding: 3px 10px;
    font-size: 12px;
    cursor: pointer;
  }
  .retry:hover {
    background: #2c2f36;
  }

  .video-box {
    position: absolute;
    overflow: hidden;
  }
  .video-box.hidden {
    visibility: hidden;
  }

  .play-prompt {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    background: rgba(0, 0, 0, 0.65);
    color: #fff;
    padding: 8px 16px;
    border-radius: 999px;
    font-size: 13px;
    pointer-events: none;
  }
  .play-prompt.cover {
    cursor: pointer;
    pointer-events: auto;
  }
  .play-prompt.cover:hover {
    background: rgba(40, 60, 120, 0.8);
  }
  .video-box video {
    position: absolute;
    left: 50%;
    top: 50%;
    cursor: pointer;
  }

  .badges {
    position: absolute;
    top: 14px;
    left: 14px;
    display: flex;
    gap: 8px;
    pointer-events: none;
  }
  .badge {
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 1px;
    padding: 4px 10px;
    border-radius: 999px;
    backdrop-filter: blur(8px);
  }
  .badge.live {
    background: rgba(255, 59, 92, 0.85);
    color: #fff;
  }
  .badge.hdr {
    background: rgba(24, 160, 251, 0.85);
    color: #fff;
  }

  .video-controls {
    position: absolute;
    bottom: 14px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    gap: 8px;
    padding: 6px 10px;
    border-radius: 10px;
    background: rgba(20, 22, 26, 0.82);
    border: 1px solid #2a2d33;
    backdrop-filter: blur(8px);
  }
  .ctl {
    border: 1px solid #34373d;
    background: #23252b;
    color: #c9cdd4;
    border-radius: 7px;
    padding: 5px 12px;
    font-size: 12px;
    cursor: pointer;
  }
  .ctl:hover {
    background: #2c2f36;
  }
  .ctl.on {
    background: #3d6ef7;
    border-color: #3d6ef7;
    color: #fff;
  }

  .zoom-hint {
    position: absolute;
    top: 14px;
    right: 14px;
    font-size: 12px;
    color: #bbb;
    background: rgba(0, 0, 0, 0.55);
    padding: 4px 10px;
    border-radius: 999px;
    pointer-events: none;
    backdrop-filter: blur(8px);
  }
</style>
