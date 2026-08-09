import { createRequire } from "module";
import assert from "node:assert";

const require = createRequire(import.meta.url);
const { scanPhoto, fullMeta, naturalCompare } = require("../electron/parser.cjs");

const LIVE = "/home/yezichao/.openclaw/workspace/20260227-144315.live.jpeg";
const UHDR = "/home/yezichao/Pictures/oppo/IMG20260121103438.jpg";

async function main() {
  // 自然排序
  assert(naturalCompare("photo2", "photo10") < 0, "natural sort");
  assert(naturalCompare("a.jpg", "b.jpg") < 0, "alpha sort");

  // ── Live Photo + Ultra HDR ──
  const s = await scanPhoto(LIVE, 42);
  console.log("scan:", JSON.stringify({ w: s.width, h: s.height, live: s.is_live, uh: !!s.ultra_hdr, xmp: s.ultra_hdr?.has_xmp_hdrgm, gmax: s.ultra_hdr?.gain_map_max }));
  assert.strictEqual(s.width, 3456);
  assert.strictEqual(s.height, 4608);
  assert.strictEqual(s.is_live, true);
  assert.ok(s.ultra_hdr && s.ultra_hdr.has_xmp_hdrgm);

  const { meta, jpeg, mp4 } = await fullMeta(LIVE, 42);
  console.log("full:", JSON.stringify({ off: meta.mp4_offset, rot: meta.video_rotation, jpeg_len: jpeg.length, mp4_len: mp4?.length }));
  assert.ok(meta.is_live && meta.mp4_offset != null);
  assert.strictEqual(meta.video_rotation, 0);
  // Live：整个文件作为 jpeg 交给浏览器（含 MP4 尾部，Chromium 忽略之），保证 gain map 完整
  assert.strictEqual(jpeg[0], 0xff);
  assert.strictEqual(jpeg[1], 0xd8);
  assert.ok(jpeg.length > 10_000_000, "jpeg 应为完整文件（含 MP4 尾部）");
  assert.ok(mp4 && mp4.length > 8_000_000);
  if (meta.ultra_hdr?.gain_map_max != null) {
    console.log("  gain_map_max =", meta.ultra_hdr.gain_map_max, "（期望 ≈1.26315）");
  }

  // ── 纯照片 Ultra HDR（无 MP4）──
  const s2 = await scanPhoto(UHDR, 7);
  console.log("scan2:", JSON.stringify({ live: s2.is_live, uh: !!s2.ultra_hdr }));
  assert.strictEqual(s2.is_live, false);
  assert.ok(s2.ultra_hdr && s2.ultra_hdr.has_xmp_hdrgm);
  const { meta: m2, mp4: mp42 } = await fullMeta(UHDR, 7);
  assert.strictEqual(m2.is_live, false);
  assert.strictEqual(mp42, null);

  console.log("\n✅ selftest 全部通过");
}

main().catch((e) => {
  console.error("❌ selftest 失败:", e.message);
  process.exit(1);
});
