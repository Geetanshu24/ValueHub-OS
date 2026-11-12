import { beforeAll, describe, expect, it } from 'vitest';
import { BASE, adminLogin, e2eEnabled, http, makeAssignment } from './helpers.js';

describe.skipIf(!e2eEnabled)('bank report (Bank of India format)', () => {
  let admin: { token: string; id: string };
  let assignmentId: string;

  beforeAll(async () => {
    admin = await adminLogin();
    assignmentId = (await makeAssignment(admin, 'LAND')).assignmentId;
  });

  const file = async (kind: string) => {
    const response = await fetch(`${BASE}/assignments/${assignmentId}/bank-report/${kind}`, { headers: { Authorization: `Bearer ${admin.token}` } });
    return { status: response.status, type: response.headers.get('content-type'), bytes: Buffer.from(await response.arrayBuffer()) };
  };

  it('suggests answers from the records and keeps what the valuer saves', async () => {
    const form = await http('GET', `/assignments/${assignmentId}/bank-report`, { token: admin.token });
    expect(form.status).toBe(200);
    expect(form.body.format).toBe('BOI');
    expect(form.body.values.purpose).toBe('Home loan');
    expect(form.body.suggested).toContain('purpose');
    expect(form.body.saved).toBe(false);

    const saved = await http('PUT', `/assignments/${assignmentId}/bank-report`, { token: admin.token, json: { values: { purpose: 'Mortgage', site_shape: 'Rectangular' } } });
    expect(saved.status).toBe(200);
    expect(saved.body.values.purpose).toBe('Mortgage');
    expect(saved.body.values.site_shape).toBe('Rectangular');
    expect(saved.body.saved).toBe(true);
  });

  it('rejects fields that are not part of the format', async () => {
    const bad = await http('PUT', `/assignments/${assignmentId}/bank-report`, { token: admin.token, json: { values: { password_hash: 'x' } } });
    expect(bad.status).toBe(400);
  });

  it('downloads the Word file and the PDF', async () => {
    const docx = await file('docx');
    expect(docx.status).toBe(200);
    expect(docx.bytes.subarray(0, 2).toString()).toBe('PK');
    const pdf = await file('pdf');
    expect(pdf.status).toBe(200);
    expect(pdf.bytes.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('keeps a separate saved form for each bank format', async () => {
    const pnb = await http('GET', `/assignments/${assignmentId}/bank-report?format=PNB`, { token: admin.token });
    expect(pnb.body.format).toBe('PNB');
    expect(pnb.body.formats.map((f: any) => f.id)).toEqual(['BOI', 'PNB', 'SBI']);
    expect(pnb.body.saved).toBe(false);
    expect(pnb.body.values.site_shape).toBeUndefined();
    expect(pnb.body.fields.length).toBeGreaterThan(150);

    const saved = await http('PUT', `/assignments/${assignmentId}/bank-report?format=PNB`, { token: admin.token, json: { values: { tp_1: 'Residential' } } });
    expect(saved.body.values.tp_1).toBe('Residential');
    const boi = await http('GET', `/assignments/${assignmentId}/bank-report?format=BOI`, { token: admin.token });
    expect(boi.body.values.tp_1).toBeUndefined();
    expect(boi.body.values.site_shape).toBe('Rectangular');

    const response = await fetch(`${BASE}/assignments/${assignmentId}/bank-report/docx?format=PNB`, { headers: { Authorization: `Bearer ${admin.token}` } });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toContain('PNB-valuation-report');
  });

  it('checks the report without AI, and says so plainly when AI is off', async () => {
    const check = await http('GET', `/assignments/${assignmentId}/bank-report/check`, { token: admin.token });
    expect(check.status).toBe(200);
    expect(Array.isArray(check.body.issues)).toBe(true);
    const status = await http('GET', `/assignments/${assignmentId}/bank-report/ai-status`, { token: admin.token });
    expect(typeof status.body.enabled).toBe('boolean');
    if (!status.body.enabled) {
      const draft = await http('POST', `/assignments/${assignmentId}/bank-report/ai/draft`, { token: admin.token, json: {} });
      expect(draft.status).toBe(503);
      expect(JSON.stringify(draft.body)).toContain('ANTHROPIC_API_KEY');
    }
  });

  it('compares the documents with the site, and has nothing to settle before there is evidence', async () => {
    const cmp = await http('GET', `/assignments/${assignmentId}/comparison`, { token: admin.token });
    expect(cmp.status).toBe(200);
    expect(cmp.body.rows.length).toBeGreaterThan(8);
    expect(cmp.body.rows.find((r: any) => r.key === 'plot_area_sqm').status).toBe('missing');
    expect(cmp.body.canProceed).toBe(true);
    const bad = await http('POST', `/assignments/${assignmentId}/comparison/plot_area_sqm/resolve`, { token: admin.token, json: { treatment: 'adopt_document', note: 'Taken from the deed.' } });
    expect(bad.status).toBe(404);
  });
});
