import sharp from 'sharp';
import { readFile } from 'node:fs/promises';
import { extractMask, DEFAULT_EXTRACTION } from '../src/core';
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

const variants: Array<{ name: string; patch: Partial<typeof DEFAULT_EXTRACTION> }> = [
  { name: 't78', patch: { threshold: 0.78 } },
  { name: 't82', patch: { threshold: 0.82 } },
];

for (const v of variants) {
  const mask = extractMask(img, { ...DEFAULT_EXTRACTION, method: 'saliency', enabled: true, ...v.patch }, 213);
  const out = Buffer.alloc(mask.width * mask.height * 4);
  for (let i = 0; i < mask.width * mask.height; i++) {
    out[i * 4] = mask.data[i];
    out[i * 4 + 1] = mask.data[i];
    out[i * 4 + 2] = mask.data[i];
    out[i * 4 + 3] = 255;
  }
  await sharp(out, { raw: { width: mask.width, height: mask.height, channels: 4 } })
    .png()
    .toFile(`test-output/mask-${v.name}.png`);
  console.log(v.name, `${mask.width}x${mask.height}`);
}
