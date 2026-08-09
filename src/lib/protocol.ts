import type { PhotoMeta } from "./types";

/**
 * 自定义 URI scheme viewer:// 的访问。
 * - Electron：viewer://local/load/{id}/{part}（registerSchemesAsPrivileged 注册的标准 scheme）
 * URL 只含不透明 id，不泄露文件系统路径。
 */
export function viewerOrigin(): string {
  return "viewer://local";
}

export function viewerUrl(id: number, part: "jpeg" | "mp4"): string {
  return `${viewerOrigin()}/load/${id}/${part}`;
}

export async function fetchBlob(id: number, part: "jpeg" | "mp4"): Promise<Blob> {
  const res = await fetch(viewerUrl(id, part));
  if (!res.ok) throw new Error(`加载失败 (${res.status})`);
  // 注意：自定义协议下 response.blob() 会报 Failed to fetch，必须用 arrayBuffer
  const ab = await res.arrayBuffer();
  return new Blob([ab]);
}

/** 应用 EXIF 旋转后的展示尺寸。 */
export function oriented(w: number, h: number, orientation: number) {
  const rotated = orientation >= 5 && orientation <= 8;
  return rotated ? { w: h, h: w } : { w, h };
}

/**
 * 用目标最大边（设备像素）创建高质量下采样 ImageBitmap。
 * naturalW/H 为存储原始尺寸；orientation 用于计算展示尺寸。
 */
export async function decodeBitmap(
  blob: Blob,
  targetMax?: number,
  naturalW?: number,
  naturalH?: number,
  orientation = 1,
): Promise<ImageBitmap> {
  if (targetMax && naturalW && naturalH) {
    const { w, h } = oriented(naturalW, naturalH, orientation);
    const scale = targetMax / Math.max(w, h);
    return createImageBitmap(blob, {
      resizeWidth: Math.max(1, Math.round(w * scale)),
      resizeHeight: Math.max(1, Math.round(h * scale)),
      imageOrientation: "from-image",
    });
  }
  return createImageBitmap(blob, { imageOrientation: "from-image" });
}
