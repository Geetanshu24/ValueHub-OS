import { beforeAll, describe, expect, it } from 'vitest';
import { adminLogin, e2eEnabled, http, makeAssignment, unique } from './helpers.js';

describe.skipIf(!e2eEnabled)('rate bank', () => {
  let admin: { token: string; id: string };
  const place = unique('Sector 14 Bank Test');

  beforeAll(async () => {
    admin = await adminLogin();
  });

  it('records rates in any unit, shows them per sq ft, and draws the month trend', async () => {
    const a = await http('POST', '/market-rates', { token: admin.token, json: { locality: place, propertyClass: 'FLAT', kind: 'TRANSACTION', rate: 13000, unit: 'SQ_FT', observedOn: '2026-10-05', source: 'Dealer A' } });
    expect(a.status).toBe(201);
    expect(a.body.ratePerSqft).toBeCloseTo(13000, 0);
    const yd = await http('POST', '/market-rates', { token: admin.token, json: { locality: place, propertyClass: 'FLAT', kind: 'ASKING', rate: 117000, unit: 'SQ_YD', observedOn: '2026-10-20', source: 'Website' } });
    expect(yd.body.ratePerSqft).toBeCloseTo(13000, -2);
    const future = await http('POST', '/market-rates', { token: admin.token, json: { locality: place, propertyClass: 'FLAT', kind: 'ASKING', rate: 1, unit: 'SQ_FT', observedOn: '2099-01-01', source: 'x' } });
    expect(future.status).toBe(400);

    const list = await http('GET', `/market-rates?q=${encodeURIComponent(place)}`, { token: admin.token });
    expect(list.body.total).toBe(2);
    const places = await http('GET', '/market-rates/localities', { token: admin.token });
    expect(places.body.some((p: any) => p.locality === place && p.count === 2)).toBe(true);
    const trend = await http('GET', `/market-rates/trend?locality=${encodeURIComponent(place)}`, { token: admin.token });
    expect(trend.body.points).toHaveLength(1);
    expect(trend.body.points[0]).toMatchObject({ month: '2026-10', count: 2 });
  });

  it('copies a rate into an assignment as comparable evidence', async () => {
    const list = await http('GET', `/market-rates?q=${encodeURIComponent(place)}`, { token: admin.token });
    const ids = await makeAssignment(admin, 'FLAT');
    const used = await http('POST', `/market-rates/${list.body.items[0].id}/use-in/${ids.assignmentId}`, { token: admin.token });
    expect(used.status).toBe(200);
    const comps = await http('GET', `/assignments/${ids.assignmentId}/comparables`, { token: admin.token });
    expect(comps.body.length).toBe(1);
    expect(comps.body[0].source).toContain('Rate bank');
  });
});
