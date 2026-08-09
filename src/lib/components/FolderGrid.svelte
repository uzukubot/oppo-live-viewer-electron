<script lang="ts">
  import { onMount } from "svelte";
  import { app, show } from "$lib/state.svelte";
  import ThumbCell from "./ThumbCell.svelte";

  const CELL = 160;
  const GAP = 12;

  let gridEl: HTMLDivElement;
  let scrollTop = $state(0);
  let viewportH = $state(600);
  let width = $state(0);
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

  const cols = $derived(Math.max(1, Math.floor((width + GAP) / (CELL + GAP))));
  const totalRows = $derived(Math.max(0, Math.ceil(filtered.length / cols)));
  const totalH = $derived(totalRows * (CELL + GAP) + GAP);

  const winStart = $derived(
    Math.max(0, Math.floor(scrollTop / (CELL + GAP)) - 1),
  );
  const winEnd = $derived(
    Math.min(
      totalRows - 1,
      winStart + Math.ceil(viewportH / (CELL + GAP)) + 2,
    ),
  );

  const cells = $derived.by(() => {
    const list: { index: number; x: number; y: number }[] = [];
    for (let r = winStart; r <= winEnd; r++) {
      for (let c = 0; c < cols; c++) {
        const pos = r * cols + c;
        if (pos >= filtered.length) break;
        list.push({
          index: filtered[pos],
          x: c * (CELL + GAP) + GAP,
          y: r * (CELL + GAP) + GAP,
        });
      }
    }
    return list;
  });

  function onScroll() {
    if (!gridEl) return;
    scrollTop = gridEl.scrollTop;
    viewportH = gridEl.clientHeight;
  }

  let lastQuery = "";
  /** 搜索词变化（含清空）时瞬移到当前照片行：过滤布局变化后网格仍停在旧位置，
   * 下一次翻页会触发跨越大段距离的平滑滚动，这里改为立即定位。 */
  $effect(() => {
    const q = app.search.trim().toLowerCase();
    if (q === lastQuery) return;
    lastQuery = q;
    const pos = filtered.indexOf(app.index);
    if (gridEl && cols > 0 && pos >= 0) {
      lastIndex = app.index;
      gridEl.scrollTop = Math.floor(pos / cols) * (CELL + GAP);
    }
  });

  /** 当前照片变化时，网格滚动到对应行。 */
  $effect(() => {
    const i = app.index;
    if (i !== lastIndex) {
      lastIndex = i;
      const pos = filtered.indexOf(i);
      if (gridEl && cols > 0 && pos >= 0) {
        const rowTop = Math.floor(pos / cols) * (CELL + GAP);
        if (rowTop < gridEl.scrollTop || rowTop + CELL > gridEl.scrollTop + gridEl.clientHeight) {
          gridEl.scrollTo({ top: rowTop, behavior: "smooth" });
        }
      }
    }
  });

  let didInitScroll = false;
  onMount(() => {
    const ro = new ResizeObserver(() => {
      if (!gridEl) return;
      width = gridEl.clientWidth;
      viewportH = gridEl.clientHeight;
      // 重新挂载（如边栏隐藏后展开）时瞬移到当前照片，避免大滚动动画
      if (!didInitScroll && cols > 0) {
        didInitScroll = true;
        lastIndex = app.index;
        const pos = filtered.indexOf(app.index);
        if (pos >= 0) gridEl.scrollTop = Math.floor(pos / cols) * (CELL + GAP);
      }
    });
    ro.observe(gridEl);
    return () => ro.disconnect();
  });
</script>

<div class="grid" bind:this={gridEl} onscroll={onScroll}>
  <div class="inner" style="height:{totalH}px;">
    {#each cells as c (c.index)}
      <button
        class="cell"
        style="left:{c.x}px;top:{c.y}px;width:{CELL}px;height:{CELL}px;"
        onclick={() => show(c.index)}
      >
        <ThumbCell meta={app.photos[c.index]} selected={app.index === c.index} />
      </button>
    {/each}
  </div>

  {#if filtered.length === 0 && !app.scanning}
    <div class="empty">无匹配文件</div>
  {/if}

  {#if app.scanning}
    <div class="scan-footer">已加载 {app.photos.length} / {app.scanTotal}，正在扫描…</div>
  {/if}
</div>

<style>
  .grid {
    position: relative;
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    background: #121212;
  }
  .grid::-webkit-scrollbar {
    width: 10px;
  }
  .grid::-webkit-scrollbar-thumb {
    background: #333;
    border-radius: 5px;
  }

  .inner {
    position: relative;
  }

  .cell {
    position: absolute;
    padding: 0;
    border: none;
    background: none;
    cursor: pointer;
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
