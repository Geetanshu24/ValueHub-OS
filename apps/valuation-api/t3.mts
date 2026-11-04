import { readFileSync, writeFileSync } from 'node:fs';
import { loadImage, createCanvas } from '@napi-rs/canvas';
const img = await loadImage(readFileSync(process.argv[2] + '/q10.png'));
const c = createCanvas(img.width, img.height); const x = c.getContext('2d'); x.drawImage(img, 0, 0);
const d = x.getImageData(0, 0, c.width, c.height); const h = new Array(8).fill(0);
for (let i = 0; i < d.data.length; i += 4) h[d.data[i] >> 5]++;
console.log(h.join(' '));
// stretch: anything below 252 gets pushed toward black
for (let i = 0; i < d.data.length; i += 4) { const v = d.data[i]; const o = v >= 253 ? 255 : Math.max(0, (v - 200) * 3); d.data[i] = d.data[i+1] = d.data[i+2] = o; }
x.putImageData(d, 0, 0); writeFileSync(process.argv[2] + '/q10b.png', c.toBuffer('image/png'));
