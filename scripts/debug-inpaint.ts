import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
import {
  computeArtSize,
  computeWorkingSize,
  DEFAULT_EXTRACTION,
  DEFAULT_INPAINT,
  extractMask,
  resizeMask,
  thresholdMask,
  dilateMask,
  featherMask,
  inpaintImage,
  resizeImage,
} from '../src/core';
import type { PixelImage } from '../src/core/types';

const { data, info } = await sharp('test-assets/scene-640x360.png')
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
const img: PixelImage = {
  width: info.width,
  height: info.height,
  data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength),
};

const art = computeArtSize(img.width, img.height, {
  mode: 'fixed-height',
  value: 120,
  exportScale: 4,
  snapEven: false,
  minSide: 16,
  maxSide: 2048,
});
const working = computeWorkingSize(art.width, art.height);
const src = resizeImage(img, working.width, working.height, 'box');
const mask = extractMask(img, { ...DEFAULT_EXTRACTION, enabled: true, method: 'saliency', threshold: 0.82, feather: 1.2 }, art.width);
let union = resizeMask(mask, working.width, working.height);
union = thresholdMask(union, 0.12);
union = dilateMask(union, Math.max(1, Math.round(working.height * 0.02)));
union = featherMask(union, Math.max(1, Math.round(working.height * 0.003)));

const saveMask = async (m: typeof mask, name: string): Promise<void> => {
  const out = Buffer.alloc(m.width * m.height * 4);
  for (let i = 0; i < m.width * m.height; i++) {
    out[i * 4] = m.data[i];
    out[i * 4 + 1] = m.data[i];
    out[i * 4 + 2] = m.data[i];
    out[i * 4 + 3] = 255;
  }
  await sharp(out, { raw: { width: m.width, height: m.height, channels: 4 } }).png().toFile(`test-output/${name}.png`);
};
await saveMask(mask, 'inpaint-subject-mask');
await saveMask(union, 'inpaint-union-mask');

for (const method of ['directional', 'diffusion', 'pyramid'] as const) {
  const res = inpaintImage(src, union, {
    ...DEFAULT_INPAINT,
    method,
    texture: 0,
    artWidth: art.width,
    artHeight: art.height,
  });
  const out = Buffer.from(res.data.buffer, res.data.byteOffset, res.data.byteLength);
  await sharp(out, { raw: { width: res.width, height: res.height, channels: 4 } }).png().toFile(`test-output/inpaint-${method}.png`);
}
console.log('done', { art, working });
