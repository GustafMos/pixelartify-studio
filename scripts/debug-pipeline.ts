import { DEFAULT_PIXELATE, defaultSettings, pixelateImage, renderPixelArt } from '../src/core';
import { buildIntegral, createImage, meanRect, sampleBilinear } from '../src/core/image';
import { applyTone } from '../src/core/image';

const img = createImage(160, 90);
for (let y = 0; y < 90; y++) {
  for (let x = 0; x < 160; x++) {
    const i = (y * 160 + x) * 4;
    img.data[i] = (x / 159) * 255;
    img.data[i + 1] = (y / 89) * 255;
    img.data[i + 2] = 128;
    img.data[i + 3] = 255;
  }
}

const integral = buildIntegral(img);
console.log('mean 0,0 5x5', meanRect(integral, { x0: 0, y0: 0, x1: 5, y1: 5 }));
const toned = { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
applyTone(toned, { brightness: 0, contrast: 1.04, saturation: 1.06, gamma: 1, hueShift: 0 });
const ti = buildIntegral(toned);
console.log('toned mean 0,0 5x5', meanRect(ti, { x0: 0, y0: 0, x1: 5, y1: 5 }));
console.log('toned pixel', Array.from(toned.data.slice(0, 4)));
console.log('source pixel', Array.from(img.data.slice(0, 4)));

console.log('sample bilinear 2.5,2.5', sampleBilinear(img, 2.5, 2.5));
const p = pixelateImage(img, { artWidth: 32, artHeight: 18, settings: DEFAULT_PIXELATE });
console.log('pixelated samples', Array.from(p.image.data.slice(0, 32)));
const p2 = pixelateImage(img, {
  artWidth: 32,
  artHeight: 18,
  settings: { ...DEFAULT_PIXELATE, colorBlend: 0, edgeAware: false },
});
console.log('mean-only samples', Array.from(p2.image.data.slice(0, 32)));
const p3 = pixelateImage(img, {
  artWidth: 32,
  artHeight: 18,
  settings: { ...DEFAULT_PIXELATE, colorBlend: 1, edgeAware: false },
});
console.log('dominant-only samples', Array.from(p3.image.data.slice(0, 32)));
const s = defaultSettings();
s.resolution = { ...s.resolution, value: 18, exportScale: 1 };
s.palette = { ...s.palette, mode: 'auto', autoCount: 8 };
s.dither = { ...s.dither, algorithm: 'none' };
const r = renderPixelArt({ image: img, settings: s }, { upscale: false });
console.log('pipeline palette', r.palette);
console.log('pipeline samples', Array.from(r.art.data.slice(0, 32)));
console.log('pipeline max', Math.max(...r.art.data));
