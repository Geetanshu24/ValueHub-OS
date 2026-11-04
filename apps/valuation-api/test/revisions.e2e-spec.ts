import { beforeAll, describe, expect, it } from 'vitest';
import { adminLogin, e2eEnabled, http, makeAssignment, makeUser, VALUATION_INPUTS } from './helpers.js';

describe.skipIf(!e2eEnabled)('queries and revisions', () => {
  let admin: { token: string; id: string };

  beforeAll(async () => {
    admin = await adminLogin();
  });

  const inFuture = (days: number) => new Date(Date.now() + days * 24 * 3600 * 1000).toISOString();

  const submitted = async () => {
    const ids = await makeAssignment(admin, 'LAND', 'APPROVED');
    const reports = await http('GET', `/assignments/${ids.assignmentId}/reports`, { token: admin.token });
    await http('POST', `/reports/${reports.body[0].id}/issue`, { token: admin.token });
    await http('POST', `/assignments/${ids.assignmentId}/submissions`, { token: admin.token, json: { reportVersionId: reports.body[0].id, channel: 'PORTAL', recipient: 'bank portal' } });
    return { ...ids, reportId: reports.body[0].id as string };
  };
  const status = async (id: string) => (await http('GET', `/assignments/${id}`, { token: admin.token })).body.status;

  it('a query blocks closing until it is answered with evidence and closed', async () => {
    const ids = await submitted();
    const reviewer = await makeUser(admin.token, 'REVIEWER');
    const q = await http('POST', `/assignments/${ids.assignmentId}/queries`, { token: reviewer.token, json: { kind: 'QUERY', question: 'Please confirm the plot area used.', dueAt: inFuture(3) } });
    expect(q.status).toBe(201);
    expect(q.body.code).toMatch(/^Q-\d{4}-\d{5}$/);
    expect(await status(ids.assignmentId)).toBe('SUBMITTED');

    const blocked = await http('PATCH', `/assignments/${ids.assignmentId}/status`, { token: admin.token, json: { status: 'CLOSED' } });
    expect(blocked.status).toBe(409);
    expect(blocked.body.message.join(' ')).toMatch(/quer/i);

    // reviewers can log and escalate, but only authorised staff answer the bank
    expect((await http('POST', `/queries/${q.body.id}/escalate`, { token: reviewer.token, json: { note: 'Needs senior valuer attention' } })).body.escalatedAt).toBeTruthy();
    expect((await http('POST', `/queries/${q.body.id}/respond`, { token: reviewer.token, json: { response: 'The adopted area is 100 sq m.' } })).status).toBe(403);

    // evidence must belong to this assignment
    const foreign = await makeAssignment(admin, 'LAND');
    const bad = await http('POST', `/queries/${q.body.id}/respond`, { token: admin.token, json: { response: 'The adopted area is 100 sq m.', evidence: [{ type: 'valuation', id: foreign.assignmentId }] } });
    expect(bad.status).toBe(400);

    expect((await http('POST', `/queries/${q.body.id}/close`, { token: admin.token })).status).toBe(409);
    const answered = await http('POST', `/queries/${q.body.id}/respond`, { token: admin.token, json: { response: 'The adopted area is 100 sq m, per the revenue record.', evidence: [{ type: 'report', id: ids.reportId, note: 'See workings' }] } });
    expect(answered.body.status).toBe('RESPONDED');
    expect(answered.body.evidence).toHaveLength(1);
    expect((await http('POST', `/queries/${q.body.id}/respond`, { token: admin.token, json: { response: 'second answer here' } })).status).toBe(409);
    expect((await http('POST', `/queries/${q.body.id}/close`, { token: admin.token })).body.status).toBe('CLOSED');

    expect((await http('PATCH', `/assignments/${ids.assignmentId}/status`, { token: admin.token, json: { status: 'CLOSED' } })).status).toBe(200);
  });

  it('lists queries firm-wide with an overdue filter and rejects a due date before receipt', async () => {
    const ids = await submitted();
    const past = await http('POST', `/assignments/${ids.assignmentId}/queries`, { token: admin.token, json: { kind: 'QUERY', question: 'Backdated query for the overdue list', receivedAt: inFuture(-5), dueAt: inFuture(-1) } });
    expect(past.status).toBe(201);
    expect((await http('POST', `/assignments/${ids.assignmentId}/queries`, { token: admin.token, json: { kind: 'QUERY', question: 'Due before received', receivedAt: inFuture(2), dueAt: inFuture(1) } })).status).toBe(400);

    const overdue = await http('GET', '/queries?overdue=true', { token: admin.token });
    expect(overdue.body.items.map((q: any) => q.id)).toContain(past.body.id);
    const reminders = await http('GET', '/dashboard/reminders', { token: admin.token });
    expect(reminders.body.some((r: any) => r.type === 'QUERY_DUE' && r.ref === past.body.code && r.overdue)).toBe(true);
  });

  it('a revision request reopens the assignment; V2 valuation and report are new versions with reasons, and nothing issued is overwritten', async () => {
    const ids = await submitted();
    const asg = ids.assignmentId;

    const early = await http('POST', `/assignments/${(await makeAssignment(admin, 'LAND')).assignmentId}/queries`, { token: admin.token, json: { kind: 'REVISION_REQUEST', question: 'Rate is too low, please revisit.', dueAt: inFuture(5) } });
    expect(early.status).toBe(409); // not submitted yet

    const request = await http('POST', `/assignments/${asg}/queries`, { token: admin.token, json: { kind: 'REVISION_REQUEST', question: 'Rate is too low, please revisit.', dueAt: inFuture(5) } });
    expect(request.status).toBe(201);
    expect(await status(asg)).toBe('REVISION');

    // V2 valuation: needs a reason
    const revised = { ...(VALUATION_INPUTS.LAND as object), land: { areaSqm: 100, ratePerSqm: 60000, rateSource: 'Fresh comparable, Sector 12' } };
    expect((await http('POST', `/assignments/${asg}/valuations`, { token: admin.token, json: revised })).status).toBe(400);
    const v2 = await http('POST', `/assignments/${asg}/valuations`, { token: admin.token, json: { ...revised, changeReason: 'Bank supplied a fresh comparable at a higher rate' } });
    expect(v2.status).toBe(201);

    const diff = await http('GET', `/assignments/${asg}/valuations/compare?from=1&to=2`, { token: admin.token });
    expect(diff.body.totalDelta).toBe(1_000_000);
    expect(diff.body.changeReason).toMatch(/fresh comparable/);
    expect(diff.body.lines[0]).toMatchObject({ component: 'Land', change: 'CHANGED' });
    expect(diff.body.lines[0].fields).toEqual(['rate', 'amount', 'sourceNote']);
    expect((await http('GET', `/assignments/${asg}/valuations/compare?from=1&to=9`, { token: admin.token })).status).toBe(404);
    expect((await http('GET', `/assignments/${asg}/valuations/compare?from=2&to=2`, { token: admin.token })).status).toBe(400);

    await http('POST', `/valuations/${v2.body.valuation.id}/submit-for-review`, { token: admin.token });
    expect((await http('PATCH', `/assignments/${asg}/status`, { token: admin.token, json: { status: 'QUALITY_REVIEW' } })).status).toBe(200);
    await http('POST', `/valuations/${v2.body.valuation.id}/approve`, { token: admin.token });

    // old report is stale for the new valuation; a new one needs a reason too
    const templates = await http('GET', `/assignments/${asg}/report-templates`, { token: admin.token });
    const templateId = templates.body.find((t: any) => t.propertyClass === 'LAND').id;
    expect((await http('POST', `/assignments/${asg}/reports`, { token: admin.token, json: { templateId } })).status).toBe(400);
    const r2 = await http('POST', `/assignments/${asg}/reports`, { token: admin.token, json: { templateId, changeReason: 'Reissued with the revised rate' } });
    expect(r2.status).toBe(201);
    expect(r2.body.qc.passed).toBe(true);

    const rdiff = await http('GET', `/assignments/${asg}/reports/compare?from=1&to=2`, { token: admin.token });
    expect(rdiff.body.totalDelta).toBe(1_000_000);
    expect(rdiff.body.changeReason).toMatch(/revised rate/);

    await http('POST', `/reports/${r2.body.id}/submit-for-review`, { token: admin.token });
    await http('POST', `/reports/${r2.body.id}/approve`, { token: admin.token });
    expect((await http('PATCH', `/assignments/${asg}/status`, { token: admin.token, json: { status: 'APPROVED' } })).status).toBe(200);
    await http('POST', `/reports/${r2.body.id}/issue`, { token: admin.token });

    const reports = await http('GET', `/assignments/${asg}/reports`, { token: admin.token });
    const byVersion = Object.fromEntries(reports.body.map((r: any) => [r.versionNumber, r.status]));
    expect(byVersion).toEqual({ 1: 'SUPERSEDED', 2: 'ISSUED' });
    // the first issued PDF is still there
    const old = await fetch(`${process.env.E2E_BASE_URL}/reports/${ids.reportId}/file`, { headers: { Authorization: `Bearer ${admin.token}` } });
    expect(old.status).toBe(200);
  });
});
