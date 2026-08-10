<script lang="ts">
  import { onMount } from "svelte";
  import { app, next, prev } from "$lib/state.svelte";
  import TopBar from "$lib/components/TopBar.svelte";
  import Sidebar from "$lib/components/Sidebar.svelte";
  import Viewer from "$lib/components/Viewer.svelte";
  import StatusBar from "$lib/components/StatusBar.svelte";
  import Welcome from "$lib/components/Welcome.svelte";
  import { openFolder, openPath } from "$lib/actions";

  /** 拖拽调整侧边栏宽度。 */
  function startResize(e: PointerEvent) {
    e.preventDefault();
    const startX = e.clientX;
    const startW = app.sidebarWidth;
    function onMove(ev: PointerEvent) {
      app.sidebarWidth = Math.min(800, Math.max(180, startW + (ev.clientX - startX)));
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function onKey(e: KeyboardEvent) {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if (!app.folder || app.photos.length === 0) return;
    switch (e.key) {
      case "ArrowDown":
      case "ArrowRight":
      case " ":
        e.preventDefault();
        next();
        break;
      case "ArrowUp":
      case "ArrowLeft":
        e.preventDefault();
        prev();
        break;
      case "Home":
        e.preventDefault();
        app.index = 0;
        break;
      case "End":
        e.preventDefault();
        app.index = app.photos.length - 1;
        break;
      case "Escape":
        app.sidebarVisible = !app.sidebarVisible;
        break;
      case "F12":
        app.showDiag = !app.showDiag;
        break;
    }
  }

  onMount(() => {
    // 拖拽文件/文件夹到窗口：经 webUtils 取真实路径后打开（打开图片 + 侧边栏列出其目录）
    function onDrop(e: DragEvent) {
      e.preventDefault();
      try {
        const dt = e.dataTransfer;
        if (!dt) return;
        // 优先 items（文件夹场景 files 可能为空）；files 兜底
        let file: File | null = null;
        if (dt.items && dt.items.length) {
          for (const item of Array.from(dt.items)) {
            const f = item.getAsFile();
            if (f) {
              file = f;
              break;
            }
          }
        }
        if (!file && dt.files && dt.files.length) file = dt.files[0];
        if (!file) return;
        const p = window.api.getPathForFile(file);
        if (p) {
          openPath(p);
        } else {
          console.warn("无法解析拖入路径:", file.name);
        }
      } catch (err) {
        console.error("drop 处理失败", err);
      }
    }
    window.addEventListener("dragover", (e) => e.preventDefault());
    window.addEventListener("drop", onDrop);

    // 右键"打开方式" / 命令行传参：主进程把路径发给渲染器（应用已在运行时用事件）
    const unOpen = window.api.onOpenPath((p) => openPath(p));

    window.addEventListener("keydown", onKey);

    // 首次启动：优先拉取外部传入的路径（打开图片 + 列出其目录）；否则恢复上次文件夹
    window.api.getPendingOpenPath().then((pendingExternal) => {
      if (pendingExternal) {
        openPath(pendingExternal);
      } else {
        const last = localStorage.getItem("lastFolder");
        if (last && !app.folder) {
          openFolder(last);
        }
      }
    });

    return () => {
      unOpen();
      window.removeEventListener("keydown", onKey);
    };
  });
</script>

<div class="app">
  <TopBar />

  {#if !app.folder}
    <Welcome />
  {:else}
    <div class="pane">
      {#if app.sidebarVisible}
        <Sidebar />
        <div
          class="resize-handle"
          role="separator"
          aria-orientation="vertical"
          aria-label="调整侧边栏宽度"
          onpointerdown={startResize}
        ></div>
      {:else}
        <button
          class="expand-btn"
          onclick={() => (app.sidebarVisible = true)}
          title="显示侧边栏"
        >
          »
        </button>
      {/if}
      <div class="main">
        <Viewer />
        <StatusBar />
      </div>
    </div>
  {/if}

  {#if app.error && app.folder}
    <div class="toast">{app.error}</div>
  {/if}
</div>

<style>
  .app {
    display: flex;
    flex-direction: column;
    height: 100vh;
    background: #121212;
    color: #e8e8e8;
  }

  .pane {
    display: flex;
    flex: 1;
    min-height: 0;
    position: relative;
  }

  .resize-handle {
    width: 5px;
    cursor: col-resize;
    flex: none;
    background: transparent;
  }
  .resize-handle:hover {
    background: rgba(61, 110, 247, 0.4);
  }

  .expand-btn {
    position: absolute;
    top: 56px;
    left: 10px;
    z-index: 10;
    border: 1px solid #34373d;
    background: #23252b;
    color: #c9cdd4;
    border-radius: 8px;
    padding: 6px 12px;
    font-size: 15px;
    cursor: pointer;
  }
  .expand-btn:hover {
    background: #2c2f36;
  }

  .main {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    min-height: 0;
  }

  .toast {
    position: fixed;
    bottom: 52px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(240, 84, 84, 0.92);
    color: #fff;
    padding: 10px 18px;
    border-radius: 10px;
    font-size: 13px;
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.4);
    z-index: 100;
  }
</style>
