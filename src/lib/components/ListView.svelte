<script lang="ts">
  import { onMount } from "svelte";
  import { app, show } from "$lib/state.svelte";
  import { displayDims } from "$lib/types";

  const ROW = 44;
  let listEl: HTMLDivElement;
  let scrollTop = $state(0);
  let viewportH = $state(600);
  let lastIndex = -1;

  /** 匹配搜索的文件（原始索引）。 */
  const filtered = $derived.by(() => {
    const q = app.search.trim().toLowerCase();
    if (!q) return app.photos.map((_, i) => i);
    const out: number[] = [];
    for (let i = 0; i < app.photos.length; i++) {
      if (app.photos[i].name.toLowerCase().includes(q)) out.push(i);
    }
    return out;
  });

  const total = $derived(filtered.length);
  const totalH = $derived(total * ROW);
  const winStart = $derived(Math.max(0, Math.floor(scrollTop / ROW) - 2));
  const winEnd = $derived(
    Math.min(total - 1, winStart + Math.ceil(viewportH / ROW) + 4),
  );
  const visible = $derived.by(() => {
    const out: { pos: number; idx: number }[] = [];
    for (let p = winStart; p <= winEnd; p++) {
      out.push({ pos: p, idx: filtered[p] });
    }
    return out;
  });

  function onScroll() {
    if (!listEl) return;
    scrollTop = listEl.scrollTop;
    viewportH = listEl.clientHeight;
  }

  let lastQuery = "";
  /** 搜索词变化（含清空）时瞬移到当前照片行：过滤布局变化后列表仍停在旧位置，
   * 下一次翻页会触发跨越大段距离的平滑滚动，这里改为立即定位。 */
  $effect(() => {
    const q = app.search.trim().toLowerCase();
    if (q === lastQuery) return;
    lastQuery = q;
    const pos = filtered.indexOf(app.index);
    if (listEl && pos >= 0) {
      lastIndex = app.index;
      listEl.scrollTop = pos * ROW;
    }
  });

  /** 当前照片变化时，列表滚动到对应行（保持选择可见）。 */
  $effect(() => {
    const i = app.index;
    if (i !== lastIndex) {
      lastIndex = i;
      const pos = filtered.indexOf(i);
      if (listEl && pos >= 0) {
        const rowTop = pos * ROW;
        if (rowTop < listEl.scrollTop || rowTop + ROW > listEl.scrollTop + listEl.clientHeight) {
          listEl.scrollTo({ top: rowTop, behavior: "smooth" });
        }
      }
    }
  });

  onMount(() => {
    const ro = new ResizeObserver(() => {
      if (listEl) viewportH = listEl.clientHeight;
    });
    ro.observe(listEl);
    // 重新挂载（如边栏隐藏后展开）时瞬移到当前照片，避免触发大滚动动画
    lastIndex = app.index;
    const pos = filtered.indexOf(app.index);
    if (listEl && pos >= 0) listEl.scrollTop = pos * ROW;
    return () => ro.disconnect();
  });
</script>

<div class="list" bind:this={listEl} onscroll={onScroll}>
  <div class="inner" style="height:{totalH}px;">
    {#each visible as v (v.idx)}
      <button
        class="row {app.index === v.idx ? 'selected' : ''}"
        style="top:{v.pos * ROW}px;height:{ROW}px;"
        onclick={() => show(v.idx)}
      >
        <span class="name" title={app.photos[v.idx].name}>{app.photos[v.idx].name}</span>
        <span class="meta">
          {#if app.photos[v.idx].is_live}
            <span class="tag live">LIVE</span>
          {/if}
          {#if app.photos[v.idx].ultra_hdr}
            <span class="tag hdr">HDR</span>
          {/if}
          <span class="dims">{displayDims(app.photos[v.idx]).w}×{displayDims(app.photos[v.idx]).h}</span>
        </span>
      </button>
    {/each}
  </div>

  {#if total === 0 && !app.scanning}
    <div class="empty">无匹配文件</div>
  {/if}

  {#if app.scanning}
    <div class="scan-footer">已加载 {app.photos.length} / {app.scanTotal}，正在扫描…</div>
  {/if}
</div>

<style>
  .list {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    background: #121212;
  }
  .list::-webkit-scrollbar {
    width: 10px;
  }
  .list::-webkit-scrollbar-thumb {
    background: #333;
    border-radius: 5px;
  }

  .inner {
    position: relative;
  }

  .row {
    position: absolute;
    left: 0;
    right: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 0 12px;
    border: none;
    border-bottom: 1px solid #1c1e22;
    background: transparent;
    color: #cfd3da;
    font-size: 13.5px;
    text-align: left;
    cursor: pointer;
  }
  .row:hover {
    background: #1b1d21;
  }
  .row.selected {
    background: rgba(61, 110, 247, 0.16);
  }

  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    font-size: 12px;
  }

  .meta {
    display: flex;
    align-items: center;
    gap: 6px;
    flex: none;
  }

  .tag {
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.5px;
    padding: 2px 6px;
    border-radius: 999px;
  }
  .tag.live {
    background: rgba(255, 59, 92, 0.2);
    color: #ff6b82;
  }
  .tag.hdr {
    background: rgba(24, 160, 251, 0.18);
    color: #4cb3ff;
  }

  .dims {
    color: #5a5e66;
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }

  .empty {
    padding: 24px 12px;
    text-align: center;
    color: #5a5e66;
    font-size: 12.5px;
  }

  .scan-footer {
    position: sticky;
    bottom: 0;
    padding: 8px 12px;
    font-size: 11.5px;
    color: #8a8f98;
    background: linear-gradient(transparent, #121212 40%);
    text-align: center;
    pointer-events: none;
  }
</style>
