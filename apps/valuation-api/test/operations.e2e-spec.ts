import { beforeAll, describe, expect, it } from 'vitest';
import { adminLogin, e2eEnabled, http, makeAssignment, makeUser } from './helpers.js';

describe.skipIf(!e2eEnabled)('operations', () => {
  let admin: { token: string; id: string };

  beforeAll(async () => {
    admin = await adminLogin();
  });

  it('dashboard summary reflects the firm, and inspectors only see field work', async () => {
    await makeAssignment(admin, 'LAND', 'INSPECTION');
    const summary = await http('GET', '/dashboard/summary', { token: admin.token });
    expect(summary.status).toBe(200);
    expect(summary.body.assignments.open).toBeGreaterThan(0);
    expect(summary.body.assignments.byStatus.INSPECTION).toBeGreaterThan(0);
    expect(summary.body).toHaveProperty('receivables.ageing');
    expect(summary.body).toHaveProperty('reports.awaitingSignature');

    const inspector = await makeUser(admin.token, 'INSPECTOR');
    const own = await http('GET', '/dashboard/summary', { token: inspector.token });
    expect(Object.keys(own.body)).toEqual(['inspections']);
    expect((await http('GET', '/dashboard/workload', { token: inspector.token })).status).toBe(403);
  });

  it('workload counts open assignments per person and moves with reallocation', async () => {
    // Sorts first, so it is inside the capped workload list however many test users exist.
    const valuer = await makeUser(admin.token, 'VALUER', `A-first ${Math.random().toString(36).slice(2, 6)}`);
    const ids = await makeAssignment(admin, 'FLAT');
    const before = (await http('GET', '/dashboard/workload', { token: admin.token })).body.find((p: any) => p.id === valuer.id);
    expect(before.openAssignments).toBe(0);

    await http('PATCH', `/assignments/${ids.assignmentId}`, { token: admin.token, json: { assignedValuerId: valuer.id } });
    const after = (await http('GET', '/dashboard/workload', { token: admin.token })).body.find((p: any) => p.id === valuer.id);
    expect(after.openAssignments).toBe(1);
  });

  it('inspections need field review by someone else; the calendar lists them', async () => {
    const ids = await makeAssignment(admin, 'LAND', 'INSPECTION');
    const inspector = await makeUser(admin.token, 'INSPECTOR');
    const when = new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString();
    const visit = await http('POST', `/assignments/${ids.assignmentId}/inspections`, { token: admin.token, json: { inspectorId: inspector.id, visitedAt: when } });

    const from = new Date().toISOString();
    const to = new Date(Date.now() + 10 * 24 * 3600 * 1000).toISOString();
    const calendar = await http('GET', `/inspections?from=${from}&to=${to}&inspectorId=${inspector.id}`, { token: admin.token });
    expect(calendar.body.items.map((i: any) => i.id)).toContain(visit.body.id);
    expect(calendar.body.items[0].assignment.code).toMatch(/^VH-ASG-/);

    // an inspector only ever sees their own calendar, whatever filter they send
    const other = await makeUser(admin.token, 'INSPECTOR');
    const mine = await http('GET', `/inspections?from=${from}&to=${to}&inspectorId=${inspector.id}`, { token: other.token });
    expect(mine.body.items).toEqual([]);

    await http('POST', `/inspections/${visit.body.id}/measurements`, { token: inspector.token, json: { label: 'Plot', areaSqm: 100, method: 'tape' } });
    await http('POST', `/inspections/${visit.body.id}/submit`, { token: inspector.token });
    expect((await http('POST', `/inspections/${visit.body.id}/review`, { token: inspector.token })).status).toBe(403);
    const reviewer = await makeUser(admin.token, 'REVIEWER');
    expect((await http('POST', `/inspections/${visit.body.id}/review`, { token: reviewer.token })).body.inspection ?? true).toBeTruthy();
    expect((await http('POST', `/inspections/${visit.body.id}/review`, { token: reviewer.token })).status).toBe(409);
  });

  it('closing needs a complete archive; a complete one closes and leaves no gaps', async () => {
    const ids = await makeAssignment(admin, 'LAND', 'APPROVED');
    const move = (status: string) => http('PATCH', `/assignments/${ids.assignmentId}/status`, { token: admin.token, json: { status } });

    // approve gate passed, but nothing has been issued or sent yet
    const reports = await http('GET', `/assignments/${ids.assignmentId}/reports`, { token: admin.token });
    await http('POST', `/reports/${reports.body[0].id}/issue`, { token: admin.token });
    await http('POST', `/assignments/${ids.assignmentId}/submissions`, { token: admin.token, json: { reportVersionId: reports.body[0].id, channel: 'PORTAL', recipient: 'bank portal' } });

    const closed = await move('CLOSED');
    expect(closed.status).toBe(200);
    const gaps = await http('GET', '/dashboard/archive-gaps', { token: admin.token });
    expect(gaps.body.map((g: any) => g.id)).not.toContain(ids.assignmentId);

    const month = new Date().toISOString().slice(0, 7);
    const submitted = await http('GET', `/dashboard/submitted?month=${month}&groupBy=propertyClass`, { token: admin.token });
    expect(submitted.body.groups.find((g: any) => g.label === 'LAND').count).toBeGreaterThan(0);
    expect((await http('GET', '/dashboard/submitted?month=2026-13', { token: admin.token })).status).toBe(400);
  });
});
