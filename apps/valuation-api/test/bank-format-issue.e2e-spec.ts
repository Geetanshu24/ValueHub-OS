import { beforeAll, describe, expect, it } from 'vitest';
import { adminLogin, e2eEnabled, http, makeAssignment, uploadDocument, BASE } from './helpers.js';

describe.skipIf(!e2eEnabled)('bank-format report through approval, issue and dispatch', () => {
  let admin: { token: string; id: string };

  beforeAll(async () => {
    admin = await adminLogin();
  });

  it('is drawn in the bank layout, approved, issued with both files, and sent', async () => {
    const ids = await makeAssignment(admin, 'HOUSE', 'QUALITY_REVIEW');
    const id = ids.assignmentId;
    const valuations = await http('GET', `/assignments/${id}/valuations`, { token: admin.token });
    await http('POST', `/valuations/${valuations.body[0].id}/approve`, { token: admin.token });
    await uploadDocument(admin.token, ids.propertyId, 'APPROVED_PLAN');
    await http('POST', '/report-templates/install-defaults', { token: admin.token });
    const templates = await http('GET', `/assignments/${id}/report-templates`, { token: admin.token });
    const templateId = templates.body.find((t: any) => t.propertyClass === 'HOUSE').id;

    const preview = await http('POST', `/assignments/${id}/reports/preview-qc`, { token: admin.token, json: { templateId, bankFormat: 'PNB' } });
    expect(preview.status).toBe(200);
    expect(preview.body.checks.some((c: any) => String(c.code).startsWith('bank.pnb'))).toBe(true);

    const created = await http('POST', `/assignments/${id}/reports`, { token: admin.token, json: { templateId, bankFormat: 'PNB' } });
    expect(created.status).toBe(201);
    expect(created.body.bankFormat).toBe('PNB');
    expect(created.body.docxKey).toBeTruthy();

    await http('POST', `/reports/${created.body.id}/submit-for-review`, { token: admin.token });
    const checklist = await http('GET', `/reports/${created.body.id}/checklist`, { token: admin.token });
    for (const item of checklist.body) await http('PUT', `/reports/${created.body.id}/checklist/${item.itemId}`, { token: admin.token, json: { checked: true } });
    expect((await http('POST', `/reports/${created.body.id}/approve`, { token: admin.token })).status).toBe(200);
    const issued = await http('POST', `/reports/${created.body.id}/issue`, { token: admin.token });
    expect(issued.status).toBe(200);
    expect(issued.body.status).toBe('ISSUED');
    expect(issued.body.sha256).toBe(created.body.sha256);

    const pdf = await fetch(`${BASE}/reports/${created.body.id}/file`, { headers: { Authorization: `Bearer ${admin.token}` } });
    expect(pdf.headers.get('content-type')).toContain('application/pdf');
    expect((await pdf.arrayBuffer()).byteLength).toBeGreaterThan(1000);
    const docx = await fetch(`${BASE}/reports/${created.body.id}/file?kind=docx`, { headers: { Authorization: `Bearer ${admin.token}` } });
    expect(docx.headers.get('content-type')).toContain('wordprocessingml');
    expect(docx.headers.get('content-disposition')).toContain('PNB');

    const sent = await http('POST', `/assignments/${id}/submissions`, { token: admin.token, json: { reportVersionId: created.body.id, channel: 'COURIER', recipient: 'Docket 12, Panipat' } });
    expect(sent.status).toBe(201);
  });

  it('refuses a Word copy for a report that is not in a bank layout', async () => {
    const ids = await makeAssignment(admin, 'LAND', 'QUALITY_REVIEW');
    const valuations = await http('GET', `/assignments/${ids.assignmentId}/valuations`, { token: admin.token });
    await http('POST', `/valuations/${valuations.body[0].id}/approve`, { token: admin.token });
    await uploadDocument(admin.token, ids.propertyId, 'REVENUE_RECORD');
    await http('POST', '/report-templates/install-defaults', { token: admin.token });
    const templates = await http('GET', `/assignments/${ids.assignmentId}/report-templates`, { token: admin.token });
    const created = await http('POST', `/assignments/${ids.assignmentId}/reports`, { token: admin.token, json: { templateId: templates.body.find((t: any) => t.propertyClass === 'LAND').id } });
    expect(created.status).toBe(201);
    const res = await fetch(`${BASE}/reports/${created.body.id}/file?kind=docx`, { headers: { Authorization: `Bearer ${admin.token}` } });
    expect(res.status).toBe(404);
  });
});
