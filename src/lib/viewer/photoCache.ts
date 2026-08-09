import { loadPhoto } from "../api";
import { fetchBlob, decodeBitmap } from "../protocol";
import type { PhotoMeta } from "../types";
import { app } from "../state.svelte";

interface Entry {
  blob?: Blob;
  /** 静态图的 objectURL。加载完成（load_photo 预热缓存）后才生成，避免竞态。 */
  jpegUrl?: string;
  /** Live Photo 视频的 objectURL。 */
  mp4Url?: string;
  loadingBlob?: Promise<Blob>;
}

const CACHE_CAP = 16;

/**
 * 图片字节/资源缓存。
 * - 静态图：先 load_photo 预热 Rust 缓存，再取字节生成 blob objectURL 交给 <img>，
 *   避免直连 viewer:// 的 404 竞态（见 KNOWN_ISSUES）；<img> 由浏览器原生解码。
 * - Live 视频：提供 mp4 objectURL；网格缩略图用 createImageBitmap 高质量下采样。
 */
class PhotoCache {
  private entries = new Map<number, Entry>();
  private order: number[] = [];
  private inFlight = new Set<number>();
  private mp4InFlight = new Map<number, Promise<string | null>>();

  private touch(id: number) {
    this.order = this.order.filter((x) => x !== id);
    this.order.unshift(id);
    while (this.order.length > CACHE_CAP) {
      const evict = this.order.pop();
      if (evict == null) break;
      const e = this.entries.get(evict);
      if (e?.jpegUrl) URL.revokeObjectURL(e.jpegUrl);
      if (e?.mp4Url) URL.revokeObjectURL(e.mp4Url);
      this.entries.delete(evict);
    }
  }

  /** 获取静态图的 objectURL（查看器 <img> 用）。先 load_photo 预热缓存再 fetch，无竞态。 */
  async ensureJpegUrl(meta: PhotoMeta): Promise<string> {
    let e = this.entries.get(meta.id);
    if (e?.jpegUrl) {
      this.touch(meta.id);
      return e.jpegUrl;
    }
    const blob = await this.ensureBlob(meta);
    if (!this.entries.has(meta.id)) this.entries.set(meta.id, {});
    const entry = this.entries.get(meta.id)!;
    if (!entry.jpegUrl) entry.jpegUrl = URL.createObjectURL(blob);
    this.touch(meta.id);
    return entry.jpegUrl;
  }

  /** 取字节；若被 LRU 淘汰导致 404，重新 load_photo 预热后再取一次。 */
  private async loadAndFetch(id: number, part: "jpeg" | "mp4"): Promise<Blob> {
    try {
      return await fetchBlob(id, part);
    } catch {
      await loadPhoto(id);
      return await fetchBlob(id, part);
    }
  }

  /** 确保 id 对应的 JPEG blob 已加载（并预热 Rust 字节缓存）。 */
  async ensureBlob(meta: PhotoMeta): Promise<Blob> {
    let e = this.entries.get(meta.id);
    if (e?.blob) {
      this.touch(meta.id);
      return e.blob;
    }
    if (this.inFlight.has(meta.id)) {
      await this.entries.get(meta.id)!.loadingBlob;
      return this.entries.get(meta.id)!.blob!;
    }
    this.inFlight.add(meta.id);
    const promise = (async () => {
      // 全量解析返回准确元数据（video_rotation / is_live / mp4_offset），
      // 回写修正扫描时的占位值（同一 id 不会重置查看器状态）。
      const updated = await loadPhoto(meta.id);
      const idx = app.photos.findIndex((p) => p.id === meta.id);
      if (idx >= 0) {
        app.photos[idx] = { ...app.photos[idx], ...updated };
      }
      return this.loadAndFetch(meta.id, "jpeg");
    })();
    if (!this.entries.has(meta.id)) this.entries.set(meta.id, {});
    const entry = this.entries.get(meta.id)!;
    entry.loadingBlob = promise;
    try {
      const blob = await promise;
      entry.blob = blob;
      this.touch(meta.id);
      return blob;
    } finally {
      this.inFlight.delete(meta.id);
    }
  }

  /** 获取 MP4 的 objectURL（Live Photo）。带并发去重，避免 effect 重跑重复 fetch。 */
  async ensureMp4Url(meta: PhotoMeta): Promise<string | null> {
    let e = this.entries.get(meta.id);
    if (e?.mp4Url) return e.mp4Url;
    if (!meta.is_live) return null;
    if (this.mp4InFlight.has(meta.id)) return this.mp4InFlight.get(meta.id)!;
    const p = (async () => {
      try {
        await this.ensureBlob(meta); // 确保已 load_photo
        const blob = await this.loadAndFetch(meta.id, "mp4");
        if (!this.entries.has(meta.id)) this.entries.set(meta.id, {});
        const entry = this.entries.get(meta.id)!;
        entry.mp4Url = URL.createObjectURL(blob);
        this.touch(meta.id);
        return entry.mp4Url;
      } catch {
        return null;
      }
    })();
    this.mp4InFlight.set(meta.id, p);
    p.finally(() => this.mp4InFlight.delete(meta.id));
    return p;
  }

  // ---- 缩略图缓存（网格用） ----
  private thumbs = new Map<number, ImageBitmap>();
  private thumbOrder: number[] = [];

  private touchThumb(id: number) {
    this.thumbOrder = this.thumbOrder.filter((x) => x !== id);
    this.thumbOrder.unshift(id);
  }

  async ensureThumb(meta: PhotoMeta): Promise<ImageBitmap | null> {
    if (this.thumbs.has(meta.id)) {
      this.touchThumb(meta.id);
      return this.thumbs.get(meta.id)!;
    }
    try {
      const blob = await this.ensureBlob(meta);
      const bmp = await decodeBitmap(
        blob,
        THUMB_MAX,
        meta.width,
        meta.height,
        meta.orientation,
      );
      this.thumbs.set(meta.id, bmp);
      this.touchThumb(meta.id);
      while (this.thumbOrder.length > 200) {
        const ev = this.thumbOrder.pop();
        if (ev != null) {
          this.thumbs.get(ev)?.close();
          this.thumbs.delete(ev);
        }
      }
      return bmp;
    } catch (err) {
      console.error("缩略图解码失败", meta.id, err);
      return null;
    }
  }

  clear() {
    for (const id of [...this.entries.keys()]) {
      const e = this.entries.get(id);
      if (e?.jpegUrl) URL.revokeObjectURL(e.jpegUrl);
      if (e?.mp4Url) URL.revokeObjectURL(e.mp4Url);
    }
    this.entries.clear();
    this.order = [];
    for (const id of [...this.thumbs.keys()]) {
      this.thumbs.get(id)?.close();
      this.thumbs.delete(id);
    }
    this.thumbOrder = [];
  }

  /** 预取邻近照片（预热 Rust 缓存），快速翻看。 */
  async prefetchNearby(photos: PhotoMeta[], index: number, radius = 2) {
    for (let d = 1; d <= radius; d++) {
      for (const i of [index - d, index + d]) {
        if (i < 0 || i >= photos.length) continue;
        const meta = photos[i];
        const e = this.entries.get(meta.id);
        if (e?.blob) continue;
        this.ensureBlob(meta).catch(() => {});
      }
    }
  }
}

export const photoCache = new PhotoCache();

/** 缩略图尺寸（设备像素）。 */
export const THUMB_MAX = 360;
