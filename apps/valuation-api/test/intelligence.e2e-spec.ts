import { beforeAll, describe, expect, it } from 'vitest';
import { adminLogin, e2eEnabled, http, makeAssignment, makeUser, unique, uploadDocument, uploadTextDocument } from './helpers.js';

describe.skipIf(!e2eEnabled)('OCR and search', () => {
  let admin: { token: string; id: string };

  beforeAll(async () => {
    admin = await adminLogin();
  });

  const deedLines = (token: string) => [
    'SALE DEED dated 12/03/2018',
    `Registry ref ${token}`,
    'The plot admeasuring 150 sq. m is situated at Khasra No. 44/2',
    'East: Road 30 ft wide',
    'West: Plot of Sh. Hari Singh',
  ];

  it('reads the text layer, suggests unverified facts with a page and confidence, and keeps reviewed ones on re-run', async () => {
    const ids = await makeAssignment(admin, 'LAND');
    const doc = await uploadTextDocument(admin.token, ids.propertyId, 'SALE_DEED', deedLines(unique('REG')));

    const run = await http('POST', `/documents/${doc.id}/ocr`, { token: admin.token });
    expect(run.status).toBe(200);
    expect(run.body).toMatchObject({ status: 'DONE', pages: 1 });
    expect(run.body.suggested).toBeGreaterThanOrEqual(4);

    const fields = (await http('GET', `/documents/${doc.id}/fields`, { token: admin.token })).body;
    const area = fields.find((f: any) => f.fieldKey === 'plot_area_sqm');
    expect(area).toMatchObject({ extractedValue: '150', state: 'UNVERIFIED', pageNumber: 1 });
    expect(Number(area.confidence)).toBeGreaterThan(0);
    expect(Number(area.confidence)).toBeLessThan(1);
    expect(fields.map((f: any) => f.fieldKey)).toEqual(expect.arrayContaining(['khasra_numbers', 'document_date', 'boundary_east']));

    // a reviewer confirms the area; a second run must not touch it
    await http('PATCH', `/document-fields/${area.id}/review`, { token: admin.token, json: { outcome: 'VERIFIED' } });
    const again = await http('POST', `/documents/${doc.id}/ocr`, { token: admin.token });
    expect(again.status).toBe(200);
    const after = (await http('GET', `/documents/${doc.id}/fields`, { token: admin.token })).body;
    expect(after.filter((f: any) => f.fieldKey === 'plot_area_sqm' && f.state === 'VERIFIED')).toHaveLength(1);
    expect(after.filter((f: any) => f.fieldKey === 'khasra_numbers')).toHaveLength(1); // re-suggested once, not duplicated

    // a confirmed OCR area feeds the discrepancy check at inspection
    await http('PATCH', `/assignments/${ids.assignmentId}/status`, { token: admin.token, json: { status: 'DOCUMENTS' } });
    await http('PATCH', `/assignments/${ids.assignmentId}/status`, { token: admin.token, json: { status: 'INSPECTION' } });
    const inspector = await makeUser(admin.token, 'INSPECTOR');
    const visit = await http('POST', `/assignments/${ids.assignmentId}/inspections`, { token: admin.token, json: { inspectorId: inspector.id, visitedAt: '2026-10-21T10:00:00Z' } });
    await http('POST', `/inspections/${visit.body.id}/measurements`, { token: inspector.token, json: { label: 'Plot', fieldKey: 'plot_area_sqm', areaSqm: 146, method: 'laser' } });
    const submitted = await http('POST', `/inspections/${visit.body.id}/submit`, { token: inspector.token });
    expect(submitted.body.discrepanciesFlagged).toBe(1);
  });

  it('a file with no text layer is reported as such, not guessed at', async () => {
    const ids = await makeAssignment(admin, 'LAND');
    const doc = await uploadDocument(admin.token, ids.propertyId, 'SALE_DEED'); // blank-ish PDF
    const run = await http('POST', `/documents/${doc.id}/ocr`, { token: admin.token });
    expect(['NO_TEXT', 'DONE']).toContain(run.body.status);
    expect(run.body.suggested).toBe(0);
    expect((await http('POST', '/documents/00000000-0000-4000-8000-000000000000/ocr', { token: admin.token })).status).toBe(404);
  });

  it('searches IDs, addresses, khasra numbers and the words inside documents, with filters', async () => {
    const marker = unique('zxqmarker').replace('-', '');
    const ids = await makeAssignment(admin, 'LAND');
    const doc = await uploadTextDocument(admin.token, ids.propertyId, 'SALE_DEED', [`Bank charge reference ${marker} registered at Panipat`]);
    await http('POST', `/documents/${doc.id}/ocr`, { token: admin.token });

    const assignment = (await http('GET', `/assignments/${ids.assignmentId}`, { token: admin.token })).body;
    const byCode = await http('GET', `/search?q=${assignment.code}`, { token: admin.token });
    expect(byCode.body.items.map((i: any) => i.id)).toContain(ids.assignmentId);

    const byText = await http('GET', `/search?q=${marker}`, { token: admin.token });
    expect(byText.body.items.map((i: any) => i.id)).toEqual([ids.assignmentId]);
    const hit = byText.body.documentHits[ids.propertyId][0];
    expect(hit.snippet).toContain(marker);
    expect(hit.fileName).toBe('deed-text.pdf');

    const filtered = await http('GET', `/search?q=${marker}&propertyClass=FLAT`, { token: admin.token });
    expect(filtered.body.total).toBe(0);
    const byDistrict = await http('GET', `/search?district=panipat&status=INTAKE&bankId=${ids.bankId}`, { token: admin.token });
    expect(byDistrict.body.items.map((i: any) => i.id)).toContain(ids.assignmentId);
    const today = new Date().toISOString().slice(0, 10);
    const byDate = await http('GET', `/search?dateField=received&from=${today}&to=${today}&bankId=${ids.bankId}`, { token: admin.token });
    expect(byDate.body.total).toBe(1);
    expect((await http('GET', '/search?from=2026-01-01', { token: admin.token })).status).toBe(200);
    expect((await http('GET', '/search?dateField=received', { token: admin.token })).status).toBe(400);
  });

  it('search is permission-filtered: an inspector only finds assignments they have been assigned a visit on, snippets included', async () => {
    const marker = unique('secretmarker').replace('-', '');
    const ids = await makeAssignment(admin, 'LAND', 'INSPECTION');
    const doc = await uploadTextDocument(admin.token, ids.propertyId, 'SALE_DEED', [`Confidential note ${marker}`]);
    await http('POST', `/documents/${doc.id}/ocr`, { token: admin.token });

    const outsider = await makeUser(admin.token, 'INSPECTOR');
    const blind = await http('GET', `/search?q=${marker}`, { token: outsider.token });
    expect(blind.body.total).toBe(0);
    expect(blind.body.documentHits).toEqual({});

    await http('POST', `/assignments/${ids.assignmentId}/inspections`, { token: admin.token, json: { inspectorId: outsider.id, visitedAt: '2026-10-21T10:00:00Z' } });
    const seen = await http('GET', `/search?q=${marker}`, { token: outsider.token });
    expect(seen.body.items.map((i: any) => i.id)).toEqual([ids.assignmentId]);
  });
});
