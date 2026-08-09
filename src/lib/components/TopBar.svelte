<script lang="ts">
  import { app } from "$lib/state.svelte";
  import { pickFolder } from "$lib/actions";
</script>

<header class="topbar">
  <div class="brand">OPPO Live Viewer</div>

  <div class="folder" title={app.folder}>
    {#if app.folder}
      <span class="dir">{app.folder}</span>
    {:else}
      <span class="hint">未打开文件夹</span>
    {/if}
  </div>

  <div class="actions">
    <button class="btn primary" onclick={pickFolder}>打开文件夹</button>
  </div>
</header>

<style>
  .topbar {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 0 18px;
    height: 52px;
    background: #17181b;
    border-bottom: 1px solid #26282d;
    flex: none;
  }

  .brand {
    font-weight: 700;
    font-size: 14px;
    letter-spacing: 0.3px;
    color: #e8e8e8;
    white-space: nowrap;
  }

  .folder {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: #8a8f98;
    font-size: 12.5px;
    font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  }

  .folder .hint {
    color: #5a5e66;
  }

  .actions {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .btn {
    border: 1px solid #34373d;
    background: #23252b;
    color: #d8dae0;
    border-radius: 8px;
    padding: 7px 16px;
    font-size: 13px;
    cursor: pointer;
    transition: background 0.15s, border-color 0.15s;
  }
  .btn:hover {
    background: #2c2f36;
    border-color: #474b54;
  }
  .btn.primary {
    background: #3d6ef7;
    border-color: #3d6ef7;
    color: #fff;
  }
  .btn.primary:hover {
    background: #2f5ee8;
  }
</style>
