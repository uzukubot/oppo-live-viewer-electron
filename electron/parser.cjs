'use strict';

// parser.rs 的 Node 移植：容器切分（JPEG / gain map / MP4）、EXIF、尺寸、
// Ultra HDR 检测、视频旋转角读取。不做任何像素解码（交给前端浏览器引擎）。

const fs = require('fs');
const path = require('path');
const { imageSize } = require('image-size');
const exifr = require('exifr');

const SUPPORTED_EXTS = ['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif', 'bmp'];

function isSupported(p) {
  const ext = path.extname(p).slice(1).toLowerCase();
  return SUPPORTED_EXTS.includes(ext);
}

/** 找到 MP4 起始偏移：ftyp 标记前 4 字节是 box size 前缀。 */
function findMp4Offset(buf) {
  const p42 = buf.indexOf(Buffer.from('ftypmp42'));
  if (p42 >= 0) return p42 - 4;
  const isom = buf.indexOf(Buffer.from('ftypisom'));
  return isom >= 0 ? isom - 4 : null;
}

function xmpNumber(xmp, key) {
  const pat = `${key}="`;
  const i = xmp.indexOf(pat);
  if (i < 0) return null;
  const rest = xmp.slice(i + pat.length);
  const end = rest.indexOf('"');
  if (end < 0) return null;
  const v = parseFloat(rest.slice(0, end).trim());
  return Number.isFinite(v) ? v : null;
}

/** 从 MP4 的 tkhd matrix 解析旋转角（0/90/180/270）。 */
function parseVideoRotation(mp4) {
  const pos = mp4.indexOf(Buffer.from('tkhd'));
  if (pos < 0) return 0;
  const version = mp4[pos + 4] || 0;
  // tkhd 版本 0：matrix 在 box 头后偏移 48；版本 1：偏移 60
  const matrixOff = version === 1 ? 60 : 48;
  const m = pos + 4 + matrixOff;
  if (m + 36 > mp4.length) return 0;
  const a = mp4.readInt32BE(m) / 65536.0;
  const b = mp4.readInt32BE(m + 4) / 65536.0;
  const deg = Math.atan2(b, a) * (180 / Math.PI);
  let rounded = Math.floor((deg + 45) / 90) * 90;
  rounded = ((rounded % 360) + 360) % 360;
  return rounded;
}

function fmtDate(v) {
  if (!v) return null;
  if (v instanceof Date) {
    const p = (n) => String(n).padStart(2, '0');
    return `${v.getFullYear()}:${p(v.getMonth() + 1)}:${p(v.getDate())} ${p(v.getHours())}:${p(v.getMinutes())}:${p(v.getSeconds())}`;
  }
  return String(v);
}

async function exifFromBytes(buf) {
  try {
    const data = await exifr.parse(buf, {
      pick: ['Orientation', 'DateTimeOriginal'],
      translateValues: false, // 保持原始 EXIF 字符串（YYYY:MM:DD HH:MM:SS）
    });
    if (!data) return { orientation: 1, date: null };
    let orientation = Number(data.Orientation) || 1;
    orientation = Math.min(Math.max(orientation, 1), 8);
    return { orientation, date: fmtDate(data.DateTimeOriginal) };
  } catch {
    return { orientation: 1, date: null };
  }
}

/** 检测 Ultra HDR 并提取 gain map 参数（仅用于徽标展示，不应用 gain map）。 */
function ultraHdrFromBytes(buf) {
  const uh = {
    gain_map_min: null,
    gain_map_max: null,
    gamma: null,
    has_xmp_hdrgm: false,
    has_iso_21496: false,
  };
  uh.has_xmp_hdrgm = buf.includes(Buffer.from('hdrgm'));
  uh.has_iso_21496 = buf.includes(Buffer.from('GainMapVersion'));
  if (!uh.has_xmp_hdrgm && !uh.has_iso_21496) return null;
  const text = buf.toString('latin1');
  uh.gain_map_min = xmpNumber(text, 'GainMapMin');
  uh.gain_map_max = xmpNumber(text, 'GainMapMax');
  uh.gamma = xmpNumber(text, 'Gamma');
  return uh;
}

function isLiveName(p) {
  return path.basename(p).toLowerCase().endsWith('.live.jpeg');
}

/** JPEG：直接扫 SOF 标记取尺寸。image-size 对截断的 JPEG buffer 会报错，这里自己解析。 */
function jpegDims(buf) {
  let i = 2; // 跳过 SOI
  while (i + 4 < buf.length) {
    if (buf[i] !== 0xff) {
      i += 1;
      continue;
    }
    const m = buf[i + 1];
    if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7)) {
      i += 2; // SOI / RST
      continue;
    }
    if (m === 0xd9 || m === 0xda) break; // EOI / SOS
    // SOF 标记：C0-CF（排除 C4 DHT、C8、CC DAC）
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
      if (i + 9 > buf.length) break;
      return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
    }
    i += 2 + buf.readUInt16BE(i + 2);
  }
  return null;
}

async function dimsOf(buf) {
  // JPEG 优先走 SOF 解析（兼容截断 buffer）；其余格式（PNG/WebP/AVIF/GIF/BMP）头部自包含，用 image-size
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xd8) {
    const d = jpegDims(buf);
    if (d) return d;
  }
  try {
    const d = await imageSize(buf);
    if (d && d.width && d.height) return { width: d.width, height: d.height };
  } catch {
    /* 尺寸读不出就算了 */
  }
  return { width: 0, height: 0 };
}

const SCAN_CHUNK = 128 * 1024; // 与 Rust 版一致：只读头部，几千张图不卡

async function readHead(p) {
  const fd = await fs.promises.open(p, 'r');
  try {
    const buf = Buffer.alloc(SCAN_CHUNK);
    const { bytesRead } = await fd.read(buf, 0, SCAN_CHUNK, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await fd.close();
  }
}

/**
 * 流式读取文件直到能解析出尺寸（对应 Rust imagesize::size 的"读够为止"）。
 * JPEG 的大段元数据（XMP/APP5/APP6）可能超过 128KB，SOF 在更后面。
 */
async function readDims(p) {
  const fd = await fs.promises.open(p, 'r');
  try {
    const CHUNK = 256 * 1024;
    const CAP = 4 * 1024 * 1024; // 上限 4MB，病理文件也不至于读太多
    let acc = Buffer.alloc(0);
    let offset = 0;
    for (;;) {
      const buf = Buffer.alloc(CHUNK);
      const { bytesRead } = await fd.read(buf, 0, CHUNK, offset);
      offset += bytesRead;
      acc = Buffer.concat([acc, buf.subarray(0, bytesRead)]);
      const d = await dimsOf(acc);
      if (d.width && d.height) return d;
      if (bytesRead < CHUNK || offset >= CAP) return d;
    }
  } finally {
    await fd.close();
  }
}

/** 扫描用（轻量）：只读文件头 + 首 128KB。 */
async function scanPhoto(p, id) {
  const name = path.basename(p);
  const size = (await fs.promises.stat(p)).size;
  const head = await readHead(p);
  const { width, height } = await readDims(p);
  const { orientation, date } = await exifFromBytes(head);
  const isLive = isLiveName(p) || head.includes(Buffer.from('MotionPhoto'));
  return {
    id,
    path: p,
    name,
    width,
    height,
    orientation,
    is_live: isLive,
    mp4_offset: null,
    video_rotation: 0,
    size,
    date,
    ultra_hdr: ultraHdrFromBytes(head),
  };
}

/** 打开单图用（全量）：精确切分 JPEG/MP4，返回准确元数据。 */
async function fullMeta(p, id) {
  const data = await fs.promises.readFile(p);
  const name = path.basename(p);
  const size = data.length;
  const { width, height } = await dimsOf(data);
  const { orientation, date } = await exifFromBytes(data);
  const ultra_hdr = ultraHdrFromBytes(data);

  const mp4Offset = findMp4Offset(data);
  let jpeg;
  let mp4;
  if (mp4Offset != null) {
    // Live：整个文件作为 jpeg 交给浏览器（Chromium 忽略 JPEG EOI 之后的 MP4 尾部）。
    // 不能截断：XMP 容器里 GainMap/MotionPhoto 的 Item:Length 以完整文件为基准，
    // 截断会让 gain map 识别失败 → 封面退化为 SDR。
    jpeg = data;
    mp4 = data.subarray(mp4Offset);
  } else {
    jpeg = data;
    mp4 = null;
  }
  const isLive = mp4 != null;
  const videoRotation = mp4 ? parseVideoRotation(mp4) : 0;

  const meta = {
    id,
    path: p,
    name,
    width,
    height,
    orientation,
    is_live: isLive,
    mp4_offset: mp4Offset,
    video_rotation: videoRotation,
    size,
    date,
    ultra_hdr,
  };
  return { meta, jpeg, mp4 };
}

/** 自然排序：photo2 < photo10（大小写不敏感）。 */
function naturalCompare(a, b) {
  const re = /(\d+)|(\D+)/g;
  const ta = (a || '').toLowerCase().match(re) || [];
  const tb = (b || '').toLowerCase().match(re) || [];
  const n = Math.max(ta.length, tb.length);
  for (let i = 0; i < n; i++) {
    const sa = ta[i] || '';
    const sb = tb[i] || '';
    if (sa === sb) continue;
    const na = /^\d+$/.test(sa);
    const nb = /^\d+$/.test(sb);
    if (na && nb) {
      const da = parseInt(sa, 10);
      const db = parseInt(sb, 10);
      if (da !== db) return da - db;
      if (sa.length !== sb.length) return sa.length - sb.length;
      continue;
    }
    if (na) return -1;
    if (nb) return 1;
    return sa < sb ? -1 : 1;
  }
  return 0;
}

module.exports = {
  SUPPORTED_EXTS,
  isSupported,
  scanPhoto,
  fullMeta,
  naturalCompare,
};
