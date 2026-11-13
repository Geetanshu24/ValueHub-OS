import { createCanvas, GlobalFonts, loadImage, type Image } from '@napi-rs/canvas';
import { existsSync } from 'node:fs';

// A location map for the bank report: the street map around the property's coordinates with a pin on it.
// Tiles come from OpenStreetMap by default (set MAP_TILE_URL to use another provider); every map carries the credit.

const TILE = 256;
const W = 1000;
const H = 640;
const ZOOM = Number(process.env.MAP_ZOOM ?? 16);
const TILE_URL = process.env.MAP_TILE_URL ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const CREDIT = process.env.MAP_CREDIT ?? '© OpenStreetMap contributors';

const cache = new Map<string, Image | null>();

async function tile(z: number, x: number, y: number): Promise<Image | null> {
  const url = TILE_URL.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
  if (cache.has(url)) return cache.get(url)!;
  let image: Image | null = null;
  try {
    const response = await fetch(url, { headers: { 'User-Agent': 'ValueHubOS/1.0 (valuation report maps)' }, signal: AbortSignal.timeout(8000) });
    if (response.ok) image = await loadImage(Buffer.from(await response.arrayBuffer()));
  } catch {
    image = null;
  }
  if (cache.size > 400) cache.delete(cache.keys().next().value as string);
  cache.set(url, image);
  return image;
}

const worldX = (lon: number, z: number) => ((lon + 180) / 360) * 2 ** z * TILE;
const worldY = (lat: number, z: number) => {
  const s = Math.sin((lat * Math.PI) / 180);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * 2 ** z * TILE;
};

const degrees = (v: number, pos: string, neg: string) => `${Math.abs(v).toFixed(6)}° ${v >= 0 ? pos : neg}`;

let fontsReady = false;
function fonts() {
  if (fontsReady) return;
  fontsReady = true;
  for (const path of [process.env.REPORT_FONT_PATH, process.env.REPORT_FONT_BOLD_PATH]) if (path && existsSync(path)) GlobalFonts.registerFromPath(path, 'ReportSans');
}
const FAMILY = 'ReportSans, Helvetica, Arial, sans-serif';

// The map as a PNG, or null when the coordinates are unusable or no map tile could be fetched.
export async function drawMap(input: { latitude: number; longitude: number; caseCode?: string }): Promise<Buffer | null> {
  const { latitude: lat, longitude: lon } = input;
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 85 || Math.abs(lon) > 180) return null;
  fonts();
  const cx = worldX(lon, ZOOM);
  const cy = worldY(lat, ZOOM);
  const left = cx - W / 2;
  const top = cy - H / 2;
  const x0 = Math.floor(left / TILE);
  const x1 = Math.floor((left + W) / TILE);
  const y0 = Math.floor(top / TILE);
  const y1 = Math.floor((top + H) / TILE);
  const wanted: { x: number; y: number }[] = [];
  for (let x = x0; x <= x1; x += 1) for (let y = y0; y <= y1; y += 1) wanted.push({ x, y });

  const loaded = await Promise.all(wanted.map(async (t) => ({ ...t, image: await tile(ZOOM, ((t.x % 2 ** ZOOM) + 2 ** ZOOM) % 2 ** ZOOM, t.y) })));
  if (loaded.every((t) => !t.image)) return null;

  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#e5e7eb';
  ctx.fillRect(0, 0, W, H);
  for (const t of loaded) if (t.image) ctx.drawImage(t.image, t.x * TILE - left, t.y * TILE - top);

  // Pin
  const px = W / 2;
  const py = H / 2;
  ctx.beginPath();
  ctx.fillStyle = 'rgba(220,38,38,0.18)';
  ctx.arc(px, py, 34, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.fillStyle = '#dc2626';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 3;
  ctx.moveTo(px, py);
  ctx.bezierCurveTo(px - 26, py - 26, px - 22, py - 62, px, py - 62);
  ctx.bezierCurveTo(px + 22, py - 62, px + 26, py - 26, px, py);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.fillStyle = '#ffffff';
  ctx.arc(px, py - 40, 8, 0, Math.PI * 2);
  ctx.fill();

  // Caption strip and credit
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.fillRect(0, 0, W, 38);
  ctx.fillStyle = '#111827';
  ctx.font = `bold 17px ${FAMILY}`;
  ctx.textAlign = 'left';
  ctx.fillText(`Property location${input.caseCode ? ` · Case ${input.caseCode}` : ''}`, 14, 25);
  ctx.font = `15px ${FAMILY}`;
  ctx.textAlign = 'right';
  ctx.fillText(`${degrees(lat, 'N', 'S')}  ${degrees(lon, 'E', 'W')}`, W - 14, 25);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillRect(W - 260, H - 22, 260, 22);
  ctx.fillStyle = '#374151';
  ctx.font = `12px ${FAMILY}`;
  ctx.textAlign = 'right';
  ctx.fillText(CREDIT, W - 8, H - 7);
  return canvas.toBuffer('image/png');
}
