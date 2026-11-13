import { describe, expect, it } from 'vitest';
import { drawSketch, plotShape } from './site-sketch.js';

describe('plotShape', () => {
  it('draws length and breadth as a rectangle', () => {
    const shape = plotShape({ site_length_ft: '60', site_breadth_ft: '40' });
    expect(shape?.basis).toBe('length and breadth');
    expect(shape?.corners[2]).toEqual([60, 40]);
  });

  it('uses four sides and a diagonal for a plot that is not a rectangle', () => {
    const shape = plotShape({ site_side_north_ft: '55', site_side_east_ft: '42', site_side_south_ft: '62', site_side_west_ft: '38', site_diagonal_ft: '68' });
    expect(shape?.basis).toBe('sides and diagonal');
    const [nw, ne, se, sw] = shape!.corners;
    expect(Math.hypot(se[0] - ne[0], se[1] - ne[1])).toBeCloseTo(42, 1);
    expect(Math.hypot(sw[0] - se[0], sw[1] - se[1])).toBeCloseTo(62, 1);
    expect(Math.hypot(sw[0] - nw[0], sw[1] - nw[1])).toBeCloseTo(38, 1);
  });

  it('says so when opposite sides differ and no diagonal was recorded', () => {
    expect(plotShape({ site_side_north_ft: '55', site_side_south_ft: '62', site_side_east_ft: '40', site_side_west_ft: '40' })?.approximate).toBe(true);
  });

  it('gives nothing when no size was recorded', () => {
    expect(plotShape({})).toBeNull();
    expect(plotShape({ site_side_north_ft: 'abc' })).toBeNull();
  });
});

describe('drawSketch', () => {
  it('draws a PNG even with nothing recorded', () => {
    const png = drawSketch({ observations: {} });
    expect(png.subarray(1, 4).toString()).toBe('PNG');
  });
});
