/**
 * Generates deterministic test scenes for manual QA (no dependencies).
 * Run: node scripts/make-test-images.mjs
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

function encodePNG(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

class Canvas {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.d = Buffer.alloc(w * h * 4);
  }
  px(x, y, r, g, b, a = 255) {
    x = Math.round(x);
    y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    if (a >= 255) {
      this.d[i] = r;
      this.d[i + 1] = g;
      this.d[i + 2] = b;
      this.d[i + 3] = 255;
    } else {
      const t = a / 255;
      this.d[i] = this.d[i] * (1 - t) + r * t;
      this.d[i + 1] = this.d[i + 1] * (1 - t) + g * t;
      this.d[i + 2] = this.d[i + 2] * (1 - t) + b * t;
      this.d[i + 3] = Math.max(this.d[i + 3], a);
    }
  }
  rect(x, y, w, h, r, g, b, a = 255) {
    for (let yy = Math.max(0, y); yy < Math.min(this.h, y + h); yy++)
      for (let xx = Math.max(0, x); xx < Math.min(this.w, x + w); xx++) this.px(xx, yy, r, g, b, a);
  }
  circle(cx, cy, rad, r, g, b, a = 255) {
    for (let y = Math.floor(cy - rad); y <= cy + rad; y++)
      for (let x = Math.floor(cx - rad); x <= cx + rad; x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d <= rad) this.px(x, y, r, g, b, a);
      }
  }
  ellipse(cx, cy, rx, ry, r, g, b, a = 255) {
    for (let y = Math.floor(cy - ry); y <= cy + ry; y++)
      for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
        const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
        if (d <= 1) this.px(x, y, r, g, b, a);
      }
  }
  polygon(points, r, g, b, a = 255) {
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [, y] of points) {
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    for (let y = Math.floor(minY); y <= maxY; y++) {
      const xs = [];
      for (let i = 0; i < points.length; i++) {
        const [x1, y1] = points[i];
        const [x2, y2] = points[(i + 1) % points.length];
        if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) {
          xs.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
        }
      }
      xs.sort((a1, b1) => a1 - b1);
      for (let i = 0; i < xs.length; i += 2) {
        for (let x = Math.floor(xs[i]); x <= xs[i + 1]; x++) this.px(x, y, r, g, b, a);
      }
    }
  }
}

function scene(w, h, transparent = false) {
  const c = new Canvas(w, h);
  const s = w / 640;
  // Sky gradient.
  for (let y = 0; y < h; y++) {
    const t = y / h;
    const r = 26 + t * 220;
    const g = 60 + t * 120;
    const b = 120 - t * 40;
    for (let x = 0; x < w; x++) c.px(x, y, r, g, b, transparent ? 0 : 255);
  }
  // Sun.
  c.circle(w * 0.72, h * 0.28, 62 * s, 255, 225, 120);
  c.circle(w * 0.72, h * 0.28, 82 * s, 255, 210, 90, 70);
  // Clouds.
  for (const [cx, cy, rr] of [
    [0.18, 0.18, 46],
    [0.27, 0.2, 34],
    [0.53, 0.14, 30],
    [0.58, 0.17, 40],
  ]) {
    c.ellipse(w * cx, h * cy, rr * s * 1.6, rr * s * 0.65, 238, 245, 255, 190);
  }
  // Mountains.
  c.polygon(
    [
      [0, h * 0.68],
      [w * 0.18, h * 0.38],
      [w * 0.31, h * 0.6],
      [w * 0.44, h * 0.34],
      [w * 0.58, h * 0.62],
      [w * 0.72, h * 0.42],
      [w * 0.9, h * 0.66],
      [w, h * 0.5],
      [w, h],
      [0, h],
    ],
    42,
    54,
    92,
  );
  c.polygon(
    [
      [0, h * 0.76],
      [w * 0.2, h * 0.56],
      [w * 0.34, h * 0.72],
      [w * 0.56, h * 0.5],
      [w * 0.74, h * 0.74],
      [w * 0.9, h * 0.58],
      [w, h * 0.72],
      [w, h],
      [0, h],
    ],
    28,
    34,
    60,
  );
  // Ground.
  c.rect(0, h * 0.82, w, h * 0.18, 38, 92, 58);
  for (let i = 0; i < 160; i++) {
    const x = ((i * 73) % 100) * 0.01 * w;
    const y = h * (0.83 + ((i * 37) % 90) * 0.0018);
    c.rect(x, y, 3 * s, 6 * s, 70 + (i % 4) * 12, 140 + (i % 3) * 20, 70);
  }
  // Central subject: a little explorer robot.
  const cx = w * 0.47;
  const cy = h * 0.66;
  c.ellipse(cx, cy + 92 * s, 54 * s, 16 * s, 20, 30, 40, 120);
  // legs
  c.rect(cx - 30 * s, cy + 38 * s, 22 * s, 58 * s, 34, 52, 78);
  c.rect(cx + 8 * s, cy + 38 * s, 22 * s, 58 * s, 34, 52, 78);
  c.rect(cx - 38 * s, cy + 92 * s, 34 * s, 12 * s, 18, 28, 44);
  c.rect(cx + 6 * s, cy + 92 * s, 34 * s, 12 * s, 18, 28, 44);
  // body
  c.rect(cx - 46 * s, cy - 34 * s, 92 * s, 76 * s, 220, 90, 54);
  c.rect(cx - 32 * s, cy - 22 * s, 64 * s, 50 * s, 255, 170, 90);
  // head
  c.rect(cx - 38 * s, cy - 92 * s, 76 * s, 58 * s, 240, 240, 232);
  c.rect(cx - 28 * s, cy - 80 * s, 56 * s, 30 * s, 30, 40, 58);
  c.circle(cx - 12 * s, cy - 66 * s, 5 * s, 80, 240, 255);
  c.circle(cx + 12 * s, cy - 66 * s, 5 * s, 80, 240, 255);
  // antenna
  c.rect(cx - 2 * s, cy - 118 * s, 4 * s, 26 * s, 200, 210, 220);
  c.circle(cx, cy - 122 * s, 7 * s, 255, 80, 120);
  // arms
  c.rect(cx - 60 * s, cy - 20 * s, 16 * s, 58 * s, 190, 76, 46);
  c.rect(cx + 44 * s, cy - 20 * s, 16 * s, 58 * s, 190, 76, 46);
  // foreground rocks
  c.polygon(
    [
      [0, h],
      [0, h * 0.9],
      [w * 0.08, h * 0.86],
      [w * 0.16, h * 0.96],
      [w * 0.21, h],
    ],
    22,
    28,
    42,
  );
  c.polygon(
    [
      [w, h],
      [w, h * 0.88],
      [w * 0.91, h * 0.84],
      [w * 0.84, h * 0.95],
      [w * 0.8, h],
    ],
    22,
    28,
    42,
  );
  return c;
}

mkdirSync('test-assets', { recursive: true });
for (const [w, h] of [
  [640, 360],
  [1920, 1080],
]) {
  const c = scene(w, h);
  writeFileSync(`test-assets/scene-${w}x${h}.png`, encodePNG(w, h, c.d));
}
console.log('wrote test-assets/scene-640x360.png and scene-1920x1080.png');
