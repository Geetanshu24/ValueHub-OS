import { beforeAll, describe, expect, it } from 'vitest';
import { adminLogin, e2eEnabled, http, makeAssignment } from './helpers.js';

describe.skipIf(!e2eEnabled)('documents against the site', () => {
  let admin: { token: string; id: string };
  let ids: Awaited<ReturnType<typeof makeAssignment>>;

  beforeAll(async () => {
    admin = await adminLogin();
    // A land assignment with a submitted inspection that measured the plot at 100 sq m.
    ids = await makeAssignment(admin, 'LAND', 'VALUATION');
    const docs = await http('GET', `/documents?propertyId=${ids.propertyId}&pageSize=10`, { token: admin.token });
    await http('POST', `/documents/${docs.body.items[0].id}/fields`, { token: admin.token, json: { fieldKey: 'plot_area_sqm', extractedValue: '120', pageNumber: 1 } });
  });

  it('flags the area that differs, holds the gate, and lets the valuer settle it with a note', async () => {
    const first = await http('GET', `/assignments/${ids.assignmentId}/comparison`, { token: admin.token });
    const area = first.body.rows.find((r: any) => r.key === 'plot_area_sqm');
    expect(area.status).toBe('mismatch');
    expect(area.needsResolution).toBe(true);
    expect(area.treatments.length).toBeGreaterThan(1);
    expect(first.body.canProceed).toBe(false);

    const short = await http('POST', `/assignments/${ids.assignmentId}/comparison/plot_area_sqm/resolve`, { token: admin.token, json: { treatment: 'adopt_document', note: 'short' } });
    expect(short.status).toBe(400);
    const wrong = await http('POST', `/assignments/${ids.assignmentId}/comparison/plot_area_sqm/resolve`, { token: admin.token, json: { treatment: 'nope', note: 'The deed area is adopted for the valuation.' } });
    expect(wrong.status).toBe(400);

    const note = 'The deed area is adopted; the site measure is a rough tape reading.';
    const settled = await http('POST', `/assignments/${ids.assignmentId}/comparison/plot_area_sqm/resolve`, { token: admin.token, json: { treatment: 'adopt_document', note } });
    expect(settled.status).toBe(200);
    const row = settled.body.rows.find((r: any) => r.key === 'plot_area_sqm');
    expect(row.discrepancy).toMatchObject({ status: 'RESOLVED', treatment: 'adopt_document', resolutionNote: note });
    expect(settled.body.canProceed).toBe(true);
  });

  it('carries the valuer\'s note into the bank report', async () => {
    const form = await http('GET', `/assignments/${ids.assignmentId}/bank-report?format=PNB`, { token: admin.token });
    expect(form.body.values.areas_clarified).toContain('The deed area is adopted');
  });
});
