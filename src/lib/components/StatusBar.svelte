<script lang="ts">
  import { app } from "$lib/state.svelte";
  import { displayDims, formatBytes, formatDate } from "$lib/types";

  const p = $derived(app.photos[app.index] ?? null);
  /** 当前显示是否被 WebView 识别为高动态范围（HDR）屏（监听变化，动态更新）。 */
  let hdrDisplay = $state(false);
  $effect(() => {
    if (typeof matchMedia === "undefined") return;
    const mq = matchMedia("(dynamic-range: high)");
    const update = () => (hdrDisplay = mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  });
</script>

{#if p}
  <footer class="statusbar">
    <span class="count">{app.index + 1} / {app.photos.length}</span>
    <span class="sep">·</span>
    <span class="name" title={p.name}>{p.name}</span>
    <span class="sep">·</span>
    <span>
      {displayDims(p).w} × {displayDims(p).h}
    </span>
    <span class="sep">·</span>
    <span>{formatBytes(p.size)}</span>
    {#if p.date}
      <span class="sep">·</span>
      <span>{formatDate(p.date)}</span>
    {/if}
    {#if p.ultra_hdr}
      <span class="sep">·</span>
      <span class="tag hdr">Ultra HDR{hdrDisplay ? "" : "（SDR 屏）"}</span>
    {/if}
    {#if p.is_live}
      <span class="sep">·</span>
      <span class="tag live">Live Photo</span>
    {/if}
  </footer>
{/if}

<style>
  .statusbar {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 0 18px;
    height: 38px;
    background: #17181b;
    border-top: 1px solid #26282d;
    flex: none;
    color: #9aa0a9;
    font-size: 12.5px;
    white-space: nowrap;
    overflow: hidden;
  }

  .sep {
    color: #3c4046;
  }

  .name {
    color: #cfd3da;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 38vw;
  }

  .tag {
    font-size: 11px;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 999px;
  }
  .tag.hdr {
    background: rgba(24, 160, 251, 0.18);
    color: #4cb3ff;
  }
  .tag.live {
    background: rgba(255, 59, 92, 0.16);
    color: #ff6b82;
  }
</style>
