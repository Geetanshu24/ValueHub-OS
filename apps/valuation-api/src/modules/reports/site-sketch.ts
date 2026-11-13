import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { existsSync } from 'node:fs';

// A schematic sketch of the plot for the bank report, drawn from what the inspector recorded on site.
// It is a sketch, not a survey: it is marked "not to scale" and says what it was drawn from.

export type Point = [number, number];
export type Side = 'North' | 'East' | 'South' | 'West';

export interface Shape {
  // Corners in the order north-west, north-east, south-east, south-west, in feet, y pointing down the page.
  corners: [Point, Point, Point, Point];
  basis: 'sides and diagonal' | 'sides' | 'length and breadth';
  approximate: boolean;
}

export interface SketchInput {
  observations: Record<string, string>;
  areaSqm?: number | null;
  caseCode?: string;
  address?: string;
}

const num = (v: string | undefined) => {
  const n = Number((v ?? '').replace(/,/g, '').match(/-?\d+(\.\d+)?/)?.[0]);
  return Number.isFinite(n) && n > 0 ? n : NaN;
};

// Two circles of radius r1 around a and r2 around b: the intersection on the side of the line a-b given by `sign`.
function circles(a: Point, b: Point, r1: number, r2: number, sign: 1 | -1): Point | null {
  const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (d === 0 || d > r1 + r2 || d < Math.abs(r1 - r2)) return null;
  const x = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(r1 * r1 - x * x, 0));
  const ux = (b[0] - a[0]) / d;
  const uy = (b[1] - a[1]) / d;
  return [a[0] + ux * x - sign * uy * h, a[1] + uy * x + sign * ux * h];
}

// The outline of the plot from the sides recorded, or null when nothing about its size was recorded.
export function plotShape(o: Record<string, string>): Shape | null {
  const n = num(o.site_side_north_ft);
  const e = num(o.site_side_east_ft);
  const s = num(o.site_side_south_ft);
  const w = num(o.site_side_west_ft);
  const d = num(o.site_diagonal_ft);

  // Four sides and a diagonal fix the shape of any four-sided plot.
  if ([n, e, s, w, d].every(Number.isFinite)) {
    const nw: Point = [0, 0];
    const ne: Point = [n, 0];
    for (const a of [1, -1] as const) {
      const se = circles(ne, nw, e, d, a);
      if (!se || se[1] <= 0) continue;
      for (const b of [1, -1] as const) {
        const sw = circles(nw, se, w, s, b);
        if (sw && sw[1] > 0 && sw[0] < se[0]) return { corners: [nw, ne, se, sw], basis: 'sides and diagonal', approximate: false };
      }
    }
  }

  const across = [n, s].filter(Number.isFinite);
  const down = [e, w].filter(Number.isFinite);
  if (across.length && down.length) {
    const width = across.reduce((t, v) => t + v, 0) / across.length;
    const height = down.reduce((t, v) => t + v, 0) / down.length;
    const exact = across.length === 2 ? Math.abs(n - s) < 0.5 : true;
    const exactDown = down.length === 2 ? Math.abs(e - w) < 0.5 : true;
    return { corners: [[0, 0], [width, 0], [width, height], [0, height]], basis: 'sides', approximate: !(exact && exactDown) };
  }

  const length = num(o.site_length_ft);
  const breadth = num(o.site_breadth_ft);
  if (Number.isFinite(length) && Number.isFinite(breadth)) return { corners: [[0, 0], [length, 0], [length, breadth], [0, breadth]], basis: 'length and breadth', approximate: false };
  return null;
}

const fontPath = process.env.REPORT_FONT_PATH;
const boldPath = process.env.REPORT_FONT_BOLD_PATH;
let fontsReady = false;
function fonts() {
  if (fontsReady) return;
  fontsReady = true;
  if (fontPath && existsSync(fontPath)) GlobalFonts.registerFromPath(fontPath, 'ReportSans');
  if (boldPath && existsSync(boldPath)) GlobalFonts.registerFromPath(boldPath, 'ReportSans');
}
const FAMILY = 'ReportSans, Helvetica, Arial, sans-serif';

const W = 1000;
const H = 780;

// Wraps text onto at most `lines` lines no wider than `width`.
function wrap(ctx: { measureText(t: string): { width: number } }, text: string, width: number, lines: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > width && line) {
      out.push(line);
      line = word;
    } else line = next;
  }
  if (line) out.push(line);
  if (out.length > lines) {
    out.length = lines;
    out[lines - 1] = `${out[lines - 1].replace(/\s*\S*$/, '')}…`;
  }
  return out;
}

export function drawSketch(input: SketchInput): Buffer {
  fonts();
  const o = input.observations;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  const shape = plotShape(o);
  // With no sizes recorded the plot is drawn as an even box so the boundaries can still be shown.
  const corners = shape?.corners ?? ([[0, 0], [10, 0], [10, 7], [0, 7]] as Shape['corners']);
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const box = { x: 230, y: 215, w: 540, h: 350 };
  const scale = Math.min(box.w / (maxX - minX || 1), box.h / (maxY - minY || 1));
  const offX = box.x + (box.w - (maxX - minX) * scale) / 2 - minX * scale;
  const offY = box.y + (box.h - (maxY - minY) * scale) / 2 - minY * scale;
  const p = corners.map(([x, y]) => [offX + x * scale, offY + y * scale] as Point);

  // Title
  ctx.fillStyle = '#111';
  ctx.font = `bold 26px ${FAMILY}`;
  ctx.textAlign = 'left';
  ctx.fillText('Boundary sketch of the property', 40, 48);
  ctx.font = `16px ${FAMILY}`;
  ctx.fillStyle = '#444';
  const basis = shape ? `Drawn from the ${shape.basis} recorded at the site visit${shape.approximate ? ' (opposite sides differ, so the outline is approximate)' : ''}. Not to scale.` : 'Sizes were not recorded at the site visit, so the outline is only indicative. Not to scale.';
  ctx.fillText(basis, 40, 76);
  const heading = [input.caseCode && `Case ${input.caseCode}`, input.address].filter(Boolean).join(' · ');
  if (heading) {
    ctx.fillStyle = '#666';
    ctx.font = `14px ${FAMILY}`;
    wrap(ctx, heading, W - 80, 1).forEach((l, i) => ctx.fillText(l, 40, 100 + i * 18));
  }

  // Road strip on the side the road is on
  const road = (['North', 'East', 'South', 'West'] as Side[]).find((sd) => sd.toLowerCase() === (o.site_road_side ?? '').trim().toLowerCase());
  const edge: Record<Side, [Point, Point]> = { North: [p[0], p[1]], East: [p[1], p[2]], South: [p[3], p[2]], West: [p[0], p[3]] };
  const out: Record<Side, Point> = { North: [0, -1], East: [1, 0], South: [0, 1], West: [-1, 0] };
  if (road) {
    const [a, b] = edge[road];
    const [dx, dy] = out[road];
    const gap = 14;
    const depth = 34;
    ctx.fillStyle = '#d9d9d9';
    ctx.beginPath();
    ctx.moveTo(a[0] + dx * gap, a[1] + dy * gap);
    ctx.lineTo(b[0] + dx * gap, b[1] + dy * gap);
    ctx.lineTo(b[0] + dx * (gap + depth), b[1] + dy * (gap + depth));
    ctx.lineTo(a[0] + dx * (gap + depth), a[1] + dy * (gap + depth));
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#333';
    ctx.font = `bold 13px ${FAMILY}`;
    ctx.textAlign = 'center';
    const mx = (a[0] + b[0]) / 2 + dx * (gap + depth / 2);
    const my = (a[1] + b[1]) / 2 + dy * (gap + depth / 2);
    const rw = num(o.road_width_ft);
    ctx.save();
    ctx.translate(mx, my + 5);
    if (dx !== 0) ctx.rotate(-Math.PI / 2 * dx);
    ctx.fillText(`ROAD${Number.isFinite(rw) ? ` ${rw} ft wide` : ''}`, 0, dx !== 0 ? -dx * 0 : 0);
    ctx.restore();
  }

  // Plot
  ctx.beginPath();
  p.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.closePath();
  ctx.fillStyle = '#f3f7f3';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#1f2937';
  ctx.stroke();

  // Area in the middle
  const cx = p.reduce((t, c) => t + c[0], 0) / 4;
  const cy = p.reduce((t, c) => t + c[1], 0) / 4;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#111';
  ctx.font = `bold 20px ${FAMILY}`;
  ctx.fillText('PLOT', cx, cy - 8);
  ctx.font = `16px ${FAMILY}`;
  const areaSqm = input.areaSqm && input.areaSqm > 0 ? input.areaSqm : undefined;
  ctx.fillText(areaSqm ? `${areaSqm.toLocaleString('en-IN', { maximumFractionDigits: 2 })} sq m` : 'Area as per report', cx, cy + 16);

  // Side lengths on the edges, and what is beyond each side
  const length: Record<Side, number> = shape
    ? { North: Math.hypot(corners[1][0] - corners[0][0], corners[1][1] - corners[0][1]), East: Math.hypot(corners[2][0] - corners[1][0], corners[2][1] - corners[1][1]), South: Math.hypot(corners[2][0] - corners[3][0], corners[2][1] - corners[3][1]), West: Math.hypot(corners[3][0] - corners[0][0], corners[3][1] - corners[0][1]) }
    : { North: NaN, East: NaN, South: NaN, West: NaN };
  const recorded: Record<Side, number> = { North: num(o.site_side_north_ft), East: num(o.site_side_east_ft), South: num(o.site_side_south_ft), West: num(o.site_side_west_ft) };
  const beyond: Record<Side, string> = { North: o.site_boundary_north, East: o.site_boundary_east, South: o.site_boundary_south, West: o.site_boundary_west } as Record<Side, string>;
  for (const side of ['North', 'East', 'South', 'West'] as Side[]) {
    const [a, b] = edge[side];
    const [dx, dy] = out[side];
    const mx = (a[0] + b[0]) / 2;
    const my = (a[1] + b[1]) / 2;
    const feet = Number.isFinite(recorded[side]) ? recorded[side] : length[side];
    ctx.fillStyle = '#111';
    ctx.font = `bold 15px ${FAMILY}`;
    ctx.textAlign = 'center';
    if (Number.isFinite(feet)) ctx.fillText(`${Number(feet.toFixed(1))} ft`, mx - dx * 22, my - dy * 22 + 5);
    ctx.fillStyle = '#374151';
    ctx.font = `14px ${FAMILY}`;
    const text = (beyond[side] ?? '').trim();
    const lines = wrap(ctx, text || 'not recorded', dx === 0 ? 420 : 180, 3);
    const far = road === side ? 82 : 58;
    const bx = mx + dx * (dx === 0 ? 0 : far + 70);
    const by = my + dy * far + (dy < 0 ? -(lines.length - 1) * 17 - 4 : dy > 0 ? 16 : -(lines.length - 1) * 8);
    ctx.fillStyle = '#6b7280';
    ctx.font = `bold 12px ${FAMILY}`;
    ctx.fillText(side.toUpperCase(), bx, by - (dy === 0 ? (lines.length * 17) / 2 + 6 : 17 + (dy < 0 ? 0 : 0)) + (dy === 0 ? 0 : dy < 0 ? -2 : 2));
    ctx.fillStyle = text ? '#111' : '#9ca3af';
    ctx.font = `14px ${FAMILY}`;
    lines.forEach((l, i) => ctx.fillText(l, bx, by + i * 17 - (dy === 0 ? (lines.length * 17) / 2 - 17 : 0)));
  }

  // North arrow
  ctx.fillStyle = '#111';
  ctx.strokeStyle = '#111';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(920, 150);
  ctx.lineTo(920, 100);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(920, 88);
  ctx.lineTo(910, 108);
  ctx.lineTo(930, 108);
  ctx.closePath();
  ctx.fill();
  ctx.font = `bold 16px ${FAMILY}`;
  ctx.textAlign = 'center';
  ctx.fillText('N', 920, 78);

  return canvas.toBuffer('image/png');
}
