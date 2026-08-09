<script lang="ts">
  import { pickFolder } from "$lib/actions";
</script>

<div class="welcome">
  <div class="icon">🎞️</div>
  <h1>OPPO Live Viewer</h1>
  <p class="sub">跨平台 OPPO Live Photo / Ultra HDR 查看器</p>
  <button class="btn primary" onclick={pickFolder}>打开文件夹</button>
  <p class="hint">或将文件夹 / 图片直接拖入窗口</p>
  <ul class="feats">
    <li>🖼️ 高质量渲染 · 色彩管理 · 100% 像素级查看</li>
    <li>📸 Android Ultra HDR 识别与徽标（真 HDR 输出待支持）</li>
    <li>🎬 Live Photo 动态播放</li>
  </ul>
</div>

<style>
  .welcome {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 10px;
    color: #d8dae0;
    background:
      radial-gradient(ellipse at 50% 30%, #1c1f24 0%, #0f0f11 70%);
  }

  .icon {
    font-size: 52px;
    margin-bottom: 4px;
  }

  h1 {
    font-size: 24px;
    margin: 0;
    font-weight: 700;
    letter-spacing: 0.3px;
  }

  .sub {
    margin: 0 0 16px;
    color: #8a8f98;
    font-size: 13.5px;
  }

  .btn {
    border: 1px solid #3d6ef7;
    background: #3d6ef7;
    color: #fff;
    border-radius: 10px;
    padding: 11px 30px;
    font-size: 14px;
    cursor: pointer;
    transition: background 0.15s;
  }
  .btn:hover {
    background: #2f5ee8;
  }

  .hint {
    color: #5a5e66;
    font-size: 12px;
    margin: 6px 0 0;
  }

  .feats {
    margin: 20px 0 0;
    padding: 0;
    list-style: none;
    text-align: left;
    color: #9aa0a9;
    font-size: 13px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid #26282d;
    border-radius: 12px;
    padding: 16px 20px;
  }
</style>
