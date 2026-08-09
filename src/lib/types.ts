/** 与 Rust 端 parser.rs 中的 PhotoMeta / UltraHdrMeta 对应。 */

export interface UltraHdrMeta {
  gain_map_min: number | null;
  gain_map_max: number | null;
  gamma: number | null;
  has_xmp_hdrgm: boolean;
  has_iso_21496: boolean;
}

export interface PhotoMeta {
  id: number;
  path: string;
  name: string;
  /** 存储的原始像素尺寸（未应用 EXIF 旋转）。 */
  width: number;
  height: number;
  /** EXIF Orientation (1-8)。 */
  orientation: number;
  /** 是否内嵌 MP4（Live Photo）。 */
  is_live: boolean;
  mp4_offset: number | null;
  /** 内嵌视频旋转角（0/90/180/270）。 */
  video_rotation: number;
  size: number;
  date: string | null;
  ultra_hdr: UltraHdrMeta | null;
}

/** 应用 EXIF 旋转后的展示尺寸。 */
export function displayDims(p: PhotoMeta): { w: number; h: number } {
  const rotated = p.orientation >= 5 && p.orientation <= 8;
  return rotated ? { w: p.height, h: p.width } : { w: p.width, h: p.height };
}

export function formatBytes(n: number): string {
  if (n >= 1024 * 1024 * 1024) return (n / (1024 * 1024 * 1024)).toFixed(2) + " GB";
  if (n >= 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + " MB";
  if (n >= 1024) return (n / 1024).toFixed(1) + " KB";
  return n + " B";
}

export function formatDate(d: string | null): string {
  if (!d) return "—";
  // EXIF 格式 "YYYY:MM:DD HH:MM:SS"
  return d.replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3");
}

/** 视频旋转角对应的 CSS transform。 */
export function rotationTransform(deg: number): string {
  return `rotate(${deg}deg)`;
}
