import { describe, expect, it } from 'vitest';
import { compareFacts } from './site-compare.js';

const site = (observations: Record<string, string> = {}, measurements: { label: string; fieldKey: string | null; areaSqm: number }[] = []) => ({ observations, measurements });
const row = (rows: ReturnType<typeof compareFacts>, key: string) => rows.find((r) => r.key === key)!;

describe('compareFacts', () => {
  it('matches wording loosely and flags real differences', () => {
    const rows = compareFacts({ boundary_east: 'House of Sharma', boundary_north: '30 ft road' }, [], site({ site_boundary_east: 'house of sharma ji', site_boundary_north: 'Park' }));
    expect(row(rows, 'boundary_east').status).toBe('match');
    expect(row(rows, 'boundary_north').status).toBe('differs');
  });

  it('applies the inspection tolerance to areas', () => {
    const near = compareFacts({ plot_area_sqm: '185' }, [], site({}, [{ label: 'Plot', fieldKey: 'plot_area_sqm', areaSqm: 185.5 }]));
    expect(row(near, 'plot_area_sqm').status).toBe('match');
    const far = compareFacts({ plot_area_sqm: '185' }, [], site({}, [{ label: 'Plot', fieldKey: 'plot_area_sqm', areaSqm: 200 }]));
    expect(row(far, 'plot_area_sqm').status).toBe('differs');
    expect(row(far, 'plot_area_sqm').note).toContain('larger');
  });

  it('adds floor measurements to get built-up area when none is tagged', () => {
    const rows = compareFacts({ built_up_area_sqm: '120' }, [], site({}, [{ label: 'Ground floor', fieldKey: null, areaSqm: 70 }, { label: 'First floor', fieldKey: null, areaSqm: 50 }]));
    expect(row(rows, 'built_up_area_sqm').status).toBe('match');
  });

  it('says when only one side has a value, and leaves open-ended facts to a person', () => {
    const rows = compareFacts({ property_address: 'Plot 12', construction_details: 'RCC' }, [], site({ construction: 'RCC framed' }));
    expect(row(rows, 'property_address').status).toBe('document_only');
    expect(row(rows, 'construction_details').status).toBe('check');
    expect(row(rows, 'road_width').status).toBe('none');
  });
});
