import { PDFDocument } from 'pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';
import { BASE, adminLogin, e2eEnabled, http, makeAssignment, makeUser, tinyPng, unique, uploadDocument } from './helpers.js';

describe.skipIf(!e2eEnabled)('report studio', () => {
  let admin: { token: string; id: string };

  beforeAll(async () => {
    admin = await adminLogin();
    await http('POST', '/report-templates/install-defaults', { token: admin.token });
  });

  const templateFor = async (assignmentId: string, propertyClass: string) => {
    const list = await http('GET', `/assignments/${assignmentId}/report-templates`, { token: admin.token });
    return list.body.find((t: any) => t.propertyClass === propertyClass).id as string;
  };

  const download = async (id: string, token = admin.token) => {
    const response = await fetch(`${BASE}/reports/${id}/file`, { headers: { Authorization: `Bearer ${token}` } });
    return { status: response.status, bytes: Buffer.from(await response.arrayBuffer()) };
  };

  it('installs defaults once, and templates are filtered by class', async () => {
    const again = await http('POST', '/report-templates/install-defaults', { token: admin.token });
    expect(again.body.created).toEqual([]);
    const ids = await makeAssignment(admin, 'LAND');
    const fit = await http('GET', `/assignments/${ids.assignmentId}/report-templates`, { token: admin.token });
    expect(fit.body.every((t: any) => t.propertyClass === 'LAND' || t.propertyClass === null)).toBe(true);
    expect(fit.body.some((t: any) => t.propertyClass === 'FLAT')).toBe(false);
  });

  it('templates are validated, and a new version retires the old one', async () => {
    const name = unique('Custom');
    const bad = await http('POST', '/report-templates', {
      token: admin.token,
      json: { name, effectiveFrom: '2026-01-01', spec: { title: 'T', sections: [{ heading: 'A', fields: [{ label: 'x', source: 'user.passwordHash', kind: 'required' }] }] } },
    });
    expect(bad.status).toBe(400);

    const spec = { title: 'Custom report', sections: [{ heading: 'A', fields: [{ label: 'Property', source: 'property.code', kind: 'required' }] }] };
    const v1 = await http('POST', '/report-templates', { token: admin.token, json: { name, effectiveFrom: '2026-01-01', spec } });
    const v2 = await http('POST', '/report-templates', { token: admin.token, json: { name, effectiveFrom: '2026-06-01', spec } });
    expect([v1.body.version, v2.body.version]).toEqual([1, 2]);
    const all = await http('GET', '/report-templates', { token: admin.token });
    const mine = all.body.filter((t: any) => t.name === name);
    expect(mine.find((t: any) => t.version === 1).isActive).toBe(false);
    expect(mine.find((t: any) => t.version === 2).isActive).toBe(true);

    const nonAdmin = await makeUser(admin.token, 'VALUER');
    expect((await http('POST', '/report-templates', { token: nonAdmin.token, json: { name, effectiveFrom: '2026-01-01', spec } })).status).toBe(403);
  });

  it('QC explains what is missing, and a failing draft cannot go to review', async () => {
    const ids = await makeAssignment(admin, 'LAND', 'VALUATION');
    const templateId = await templateFor(ids.assignmentId, 'LAND');

    const noValuation = await http('POST', `/assignments/${ids.assignmentId}/reports`, { token: admin.token, json: { templateId } });
    expect(noValuation.status).toBe(400);
    expect(JSON.stringify(noValuation.body)).toMatch(/valuation/i);

    const valuation = await http('POST', `/assignments/${ids.assignmentId}/valuations`, { token: admin.token, json: { areaSource: 'Revenue record', land: { areaSqm: 100, ratePerSqm: 1000, rateSource: 'Comparable A' } } });
    const qc = await http('POST', `/assignments/${ids.assignmentId}/reports/preview-qc`, { token: admin.token, json: { templateId } });
    expect(qc.status).toBe(200);
    const failed = qc.body.checks.filter((c: any) => c.status === 'FAIL').map((c: any) => c.code);
    expect(failed).toContain('annexures_present'); // land needs a revenue record
    expect(failed).toContain('valuation_state'); // still a draft
    await http('POST', `/valuations/${valuation.body.valuation.id}/submit-for-review`, { token: admin.token });
    const draft = await http('POST', `/assignments/${ids.assignmentId}/reports`, { token: admin.token, json: { templateId } });
    expect(draft.status).toBe(201);
    expect(draft.body.qc.passed).toBe(false);
    expect((await http('POST', `/reports/${draft.body.id}/submit-for-review`, { token: admin.token })).status).toBe(409);

    // a draft PDF is still downloadable so the preparer can see it
    const file = await download(draft.body.id);
    expect(file.status).toBe(200);
    expect(file.bytes.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('full lifecycle: draft -> review -> approve -> issue, with annexures merged into the PDF', async () => {
    const ids = await makeAssignment(admin, 'LAND', 'APPROVED');
    const reports = await http('GET', `/assignments/${ids.assignmentId}/reports`, { token: admin.token });
    const approved = reports.body[0];
    expect(approved.status).toBe('APPROVED');
    expect(approved.qc.passed).toBe(true);

    const issued = await http('POST', `/reports/${approved.id}/issue`, { token: admin.token });
    expect(issued.status).toBe(200);
    expect(issued.body.status).toBe('ISSUED');
    expect(issued.body.sha256).not.toBe(approved.sha256);

    const pdf = await download(approved.id);
    const doc = await PDFDocument.load(pdf.bytes);
    // body (1+) + 2 annexure dividers + 2 annexure pages + 1 photo page
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(6);

    // immutable once issued
    expect((await http('POST', `/reports/${approved.id}/issue`, { token: admin.token })).status).toBe(409);
    expect((await http('POST', `/reports/${approved.id}/approve`, { token: admin.token })).status).toBe(409);
  });

  it('assignment cannot be approved without an approved report, nor submitted without an issued one', async () => {
    const ids = await makeAssignment(admin, 'LAND', 'VALUATION');
    await uploadDocument(admin.token, ids.propertyId, 'REVENUE_RECORD');
    const valuation = await http('POST', `/assignments/${ids.assignmentId}/valuations`, { token: admin.token, json: { areaSource: 'Revenue record', land: { areaSqm: 100, ratePerSqm: 1000, rateSource: 'Comparable A' } } });
    await http('POST', `/valuations/${valuation.body.valuation.id}/submit-for-review`, { token: admin.token });
    await http('PATCH', `/assignments/${ids.assignmentId}/status`, { token: admin.token, json: { status: 'QUALITY_REVIEW' } });
    await http('POST', `/valuations/${valuation.body.valuation.id}/approve`, { token: admin.token });

    const blocked = await http('PATCH', `/assignments/${ids.assignmentId}/status`, { token: admin.token, json: { status: 'APPROVED' } });
    expect(blocked.status).toBe(409);
    expect(blocked.body.message.join(' ')).toMatch(/report/i);

    const templateId = await templateFor(ids.assignmentId, 'LAND');
    const report = await http('POST', `/assignments/${ids.assignmentId}/reports`, { token: admin.token, json: { templateId } });
    await http('POST', `/reports/${report.body.id}/submit-for-review`, { token: admin.token });
    await http('POST', `/reports/${report.body.id}/approve`, { token: admin.token });
    expect((await http('PATCH', `/assignments/${ids.assignmentId}/status`, { token: admin.token, json: { status: 'APPROVED' } })).status).toBe(200);

    const early = await http('PATCH', `/assignments/${ids.assignmentId}/status`, { token: admin.token, json: { status: 'SUBMITTED' } });
    expect(early.status).toBe(409);
    expect(early.body.message.join(' ')).toMatch(/issue a report/i);
  });

  it('four-eyes on reports, and a stale report cannot be approved after a newer valuation', async () => {
    const ids = await makeAssignment(admin, 'LAND', 'QUALITY_REVIEW');
    await uploadDocument(admin.token, ids.propertyId, 'REVENUE_RECORD');
    const author = await makeUser(admin.token, 'VALUER');
    const templateId = await templateFor(ids.assignmentId, 'LAND');
    const report = await http('POST', `/assignments/${ids.assignmentId}/reports`, { token: author.token, json: { templateId } });
    expect(report.body.qc.passed).toBe(true);
    await http('POST', `/reports/${report.body.id}/submit-for-review`, { token: author.token });
    expect((await http('POST', `/reports/${report.body.id}/approve`, { token: author.token })).status).toBe(403);

    // a revised valuation makes the report stale
    await http('PATCH', `/assignments/${ids.assignmentId}/status`, { token: admin.token, json: { status: 'VALUATION' } });
    const second = await http('POST', `/assignments/${ids.assignmentId}/valuations`, {
      token: admin.token,
      json: { areaSource: 'Revenue record', land: { areaSqm: 100, ratePerSqm: 1200, rateSource: 'Comparable B' }, changeReason: 'Updated rate after fresh evidence' },
    });
    expect(second.status).toBe(201);
    const reviewer = await makeUser(admin.token, 'REVIEWER');
    const stale = await http('POST', `/reports/${report.body.id}/approve`, { token: reviewer.token });
    expect([400, 409]).toContain(stale.status);
  });

  it('report snapshots keep the source of every figure', async () => {
    const ids = await makeAssignment(admin, 'HOUSE', 'APPROVED');
    const reports = await http('GET', `/assignments/${ids.assignmentId}/reports`, { token: admin.token });
    const full = await http('GET', `/reports/${reports.body[0].id}`, { token: admin.token });
    const snapshot = full.body.snapshot;
    expect(snapshot.workings.lines.every((l: any) => l.treatment !== 'SEPARATELY_VALUED' || l.sourceNote)).toBe(true);
    expect(snapshot.template.version).toBeGreaterThanOrEqual(1);
    expect(snapshot.valuation.engineVersion).toMatch(/^property-engines\//);
    expect(tinyPng().length).toBeGreaterThan(0);
  });
});
