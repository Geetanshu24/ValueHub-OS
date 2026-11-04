import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminLogin, e2eEnabled, http, makeAssignment, makeUser, unique } from './helpers.js';

describe.skipIf(!e2eEnabled)('admin configuration', () => {
  let admin: { token: string; id: string };
  const cleanup: (() => Promise<unknown>)[] = [];

  beforeAll(async () => {
    admin = await adminLogin();
  });
  afterAll(async () => {
    for (const undo of cleanup.reverse()) await undo();
  });

  it('only admins touch configuration', async () => {
    const valuer = await makeUser(admin.token, 'VALUER');
    expect((await http('GET', '/admin/settings', { token: valuer.token })).status).toBe(403);
    expect((await http('PUT', '/admin/settings/retention', { token: valuer.token, json: { retentionYears: 8 } })).status).toBe(403);
    expect((await http('POST', '/admin/fee-rules', { token: valuer.token, json: { amount: 1, effectiveFrom: '2026-01-01' } })).status).toBe(403);
  });

  it('the most specific fee rule fills in a new assignment fee', async () => {
    const bank = await http('POST', '/banks', { token: admin.token, json: { name: unique('FeeBank') } });
    const mk = async (json: object) => {
      const rule = await http('POST', '/admin/fee-rules', { token: admin.token, json });
      cleanup.push(() => http('DELETE', `/admin/fee-rules/${rule.body.id}`, { token: admin.token }));
      return rule;
    };
    await mk({ amount: 2000, effectiveFrom: '2026-01-01' });
    await mk({ propertyClass: 'LAND', amount: 3000, effectiveFrom: '2026-01-01' });
    await mk({ bankId: bank.body.id, amount: 4000, effectiveFrom: '2026-01-01' });
    await mk({ bankId: bank.body.id, propertyClass: 'LAND', amount: 5000, effectiveFrom: '2026-01-01' });
    await mk({ bankId: bank.body.id, propertyClass: 'LAND', amount: 9999, effectiveFrom: '2099-01-01' }); // not in force yet

    const create = async (propertyClass: string, bankId: string, extra: object = {}) => {
      const property = await http('POST', '/properties', { token: admin.token, json: { propertyClass, addressLine: `${unique('Plot')} Test Road` } });
      return http('POST', '/assignments', { token: admin.token, json: { bankId, propertyId: property.body.id, assignedValuerId: admin.id, purpose: 'Loan', valuationDate: '2026-10-22', dueDate: '2030-12-30', ...extra } });
    };
    expect((await create('LAND', bank.body.id)).body.fee).toBe('5000');
    expect((await create('FLAT', bank.body.id)).body.fee).toBe('4000');
    expect((await create('LAND', bank.body.id, { fee: 1234 })).body.fee).toBe('1234');
    const otherBank = await http('POST', '/banks', { token: admin.token, json: { name: unique('FeeBank') } });
    expect((await create('LAND', otherBank.body.id)).body.fee).toBe('3000');
    expect((await create('FLAT', otherBank.body.id)).body.fee).toBe('2000');
  });

  it('the review checklist must be ticked before a report is approved', async () => {
    const item = await http('POST', '/admin/checklist', { token: admin.token, json: { label: `Area matches deed (${unique('c')})`, propertyClass: 'LAND' } });
    expect(item.status).toBe(201);
    // other specs approve reports too, so this item is retired as soon as this test is done
    const retire = () => http('PATCH', `/admin/checklist/${item.body.id}`, { token: admin.token, json: { isActive: false } });
    cleanup.push(retire);
    try {

    const ids = await makeAssignment(admin, 'LAND', 'QUALITY_REVIEW');
    await http('POST', '/report-templates/install-defaults', { token: admin.token });
    const { uploadDocument } = await import('./helpers.js');
    await uploadDocument(admin.token, ids.propertyId, 'REVENUE_RECORD');
    const templates = await http('GET', `/assignments/${ids.assignmentId}/report-templates`, { token: admin.token });
    const report = await http('POST', `/assignments/${ids.assignmentId}/reports`, { token: admin.token, json: { templateId: templates.body.find((t: any) => t.propertyClass === 'LAND').id } });
    await http('POST', `/reports/${report.body.id}/submit-for-review`, { token: admin.token });

    const valuation = (await http('GET', `/assignments/${ids.assignmentId}/valuations`, { token: admin.token })).body[0];
    await http('POST', `/valuations/${valuation.id}/approve`, { token: admin.token });
    const list = await http('GET', `/reports/${report.body.id}/checklist`, { token: admin.token });
    expect(list.body.map((i: any) => i.itemId)).toContain(item.body.id);

    const blocked = await http('POST', `/reports/${report.body.id}/approve`, { token: admin.token });
    expect(blocked.status).toBe(409);
    expect(blocked.body.message.join(' ')).toContain('Area matches deed');

    const tick = await http('PUT', `/reports/${report.body.id}/checklist/${item.body.id}`, { token: admin.token, json: { checked: true, note: 'Checked against the revenue record' } });
    expect(tick.status).toBe(200);
    expect((await http('POST', `/reports/${report.body.id}/approve`, { token: admin.token })).status).toBe(200);
    // closed once approved
    expect((await http('PUT', `/reports/${report.body.id}/checklist/${item.body.id}`, { token: admin.token, json: { checked: false } })).status).toBe(409);
    } finally {
      await retire();
    }
  });

  it('retention dates are set on closing and legal hold keeps a record out of the review list', async () => {
    expect((await http('PUT', '/admin/settings/retention', { token: admin.token, json: { retentionYears: 0 } })).status).toBe(400);
    const set = await http('PUT', '/admin/settings/retention', { token: admin.token, json: { retentionYears: 8 } });
    expect(set.body.retentionYears).toBe(8);

    const ids = await makeAssignment(admin, 'LAND', 'APPROVED');
    const reports = await http('GET', `/assignments/${ids.assignmentId}/reports`, { token: admin.token });
    await http('POST', `/reports/${reports.body[0].id}/issue`, { token: admin.token });
    await http('POST', `/assignments/${ids.assignmentId}/submissions`, { token: admin.token, json: { reportVersionId: reports.body[0].id, channel: 'PORTAL', recipient: 'bank portal' } });
    expect((await http('PATCH', `/assignments/${ids.assignmentId}/status`, { token: admin.token, json: { status: 'CLOSED' } })).status).toBe(200);

    const hold = await http('POST', `/assignments/${ids.assignmentId}/legal-hold`, { token: admin.token, json: { reason: 'Court notice 12/2026' } });
    expect(hold.body.legalHold).toBe(true);
    expect((await http('POST', `/assignments/${ids.assignmentId}/legal-hold`, { token: admin.token, json: { reason: 'Again, for good measure' } })).status).toBe(409);
    const report = await http('GET', '/admin/retention', { token: admin.token });
    expect(report.body.retentionYears).toBe(8);
    expect(report.body.onHold.map((a: any) => a.id)).toContain(ids.assignmentId);

    const released = await http('POST', `/assignments/${ids.assignmentId}/legal-hold/release`, { token: admin.token, json: { reason: 'Matter concluded' } });
    expect(released.body.legalHold).toBe(false);
    const trail = await http('GET', `/audit?entityId=${ids.assignmentId}`, { token: admin.token });
    expect(trail.body.items.map((e: any) => e.action)).toEqual(expect.arrayContaining(['assignment.legal_hold_set', 'assignment.legal_hold_released']));

    const detail = await http('GET', '/admin/retention', { token: admin.token });
    expect(detail.body.dueForReview.map((a: any) => a.id)).not.toContain(ids.assignmentId); // 8 years away
  });
});
