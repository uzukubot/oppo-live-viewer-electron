<script lang="ts">
  import { photoCache } from "$lib/viewer/photoCache";
  import type { PhotoMeta } from "$lib/types";

  interface Props {
    meta: PhotoMeta;
    selected: boolean;
  }
  let { meta, selected }: Props = $props();

  let canvas: HTMLCanvasElement | undefined = $state();
  let cancelled = false;

  $effect(() => {
    void meta;
    void canvas;
    load();
  });

  $effect(() => {
    // 失焦时关闭，释放内存
    if (!selected) return;
    load();
  });

  async function load() {
    if (!canvas || cancelled) return;
    const bmp = await photoCache.ensureThumb(meta);
    if (!canvas || cancelled || !bmp) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    // cover 裁剪
    const s = Math.max(W / bmp.width, H / bmp.height);
    const dw = bmp.width * s;
    const dh = bmp.height * s;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bmp, (W - dw) / 2, (H - dh) / 2, dw, dh);
  }
</script>

<div class="thumb-wrap {selected ? 'selected' : ''}">
  <canvas
    bind:this={canvas}
    class="thumb-canvas"
    width="240"
    height="240"
  ></canvas>
  <div class="tags">
    {#if meta.is_live}
      <span class="tag live">LIVE</span>
    {/if}
    {#if meta.ultra_hdr}
      <span class="tag hdr">HDR</span>
    {/if}
  </div>
</div>

<style>
  .thumb-wrap {
    position: absolute;
    inset: 0;
    border-radius: 10px;
    overflow: hidden;
    background: #202227;
    border: 2px solid transparent;
    transition: border-color 0.12s, transform 0.12s;
  }
  .thumb-wrap:hover {
    border-color: #3a3e46;
    transform: scale(1.02);
  }
  .thumb-wrap.selected {
    border-color: #3d6ef7;
  }

  .thumb-canvas {
    width: 100%;
    height: 100%;
    display: block;
  }

  .tags {
    position: absolute;
    top: 6px;
    right: 6px;
    display: flex;
    gap: 5px;
    pointer-events: none;
  }
  .tag {
    font-size: 9.5px;
    font-weight: 700;
    letter-spacing: 0.5px;
    padding: 2px 7px;
    border-radius: 999px;
  }
  .tag.live {
    background: rgba(255, 59, 92, 0.85);
    color: #fff;
  }
  .tag.hdr {
    background: rgba(24, 160, 251, 0.85);
    color: #fff;
  }
</style>
