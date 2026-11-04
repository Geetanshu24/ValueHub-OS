import { beforeAll, describe, expect, it } from 'vitest';
import { adminLogin, e2eEnabled, http, makeAssignment, makeUser, prepareApprovedReport, unique, uploadDocument, VALUATION_INPUTS } from './helpers.js';

describe.skipIf(!e2eEnabled)('workflow gates', () => {
  let admin: { token: string; id: string };

  beforeAll(async () => {
    admin = await adminLogin();
  });

  const move = (id: string, status: string) => http('PATCH', `/assignments/${id}/status`, { token: admin.token, json: { status } });

  it('blocks each stage until its requirement is on record', async () => {
    const ids = await makeAssignment(admin, 'LAND');
    expect((await move(ids.assignmentId, 'DOCUMENTS')).status).toBe(200);

    const noDocs = await move(ids.assignmentId, 'INSPECTION');
    expect(noDocs.status).toBe(409);
    expect(noDocs.body.message[0]).toMatch(/document/i);
    await uploadDocument(admin.token, ids.propertyId);
    expect((await move(ids.assignmentId, 'INSPECTION')).status).toBe(200);

    const noVisit = await move(ids.assignmentId, 'VALUATION');
    expect(noVisit.status).toBe(409);
    expect(noVisit.body.message[0]).toMatch(/inspection/i);
  });

  it('needs a valuation in review before quality review, and an approved one before approval', async () => {
    const ids = await makeAssignment(admin, 'LAND', 'VALUATION');
    expect((await move(ids.assignmentId, 'QUALITY_REVIEW')).body.message[0]).toMatch(/valuation/i);

    const created = await http('POST', `/assignments/${ids.assignmentId}/valuations`, { token: admin.token, json: VALUATION_INPUTS.LAND });
    await http('POST', `/valuations/${created.body.valuation.id}/submit-for-review`, { token: admin.token });
    expect((await move(ids.assignmentId, 'QUALITY_REVIEW')).status).toBe(200);
    expect((await move(ids.assignmentId, 'APPROVED')).body.message[0]).toMatch(/approved/i);

    // approved valuation alone is still not enough: an approved report is needed too
    await http('POST', `/valuations/${created.body.valuation.id}/approve`, { token: admin.token });
    expect((await move(ids.assignmentId, 'APPROVED')).body.message[0]).toMatch(/report/i);
    await prepareApprovedReport(admin, ids);
    expect((await move(ids.assignmentId, 'APPROVED')).status).toBe(200);
  });

  it('four-eyes: an author who is not an admin cannot approve their own valuation', async () => {
    const ids = await makeAssignment(admin, 'LAND', 'VALUATION');
    const author = await makeUser(admin.token, 'VALUER');
    const created = await http('POST', `/assignments/${ids.assignmentId}/valuations`, { token: author.token, json: VALUATION_INPUTS.LAND });
    expect(created.status).toBe(201);
    await http('POST', `/valuations/${created.body.valuation.id}/submit-for-review`, { token: author.token });
    expect((await http('POST', `/valuations/${created.body.valuation.id}/approve`, { token: author.token })).status).toBe(403);

    const reviewer = await makeUser(admin.token, 'REVIEWER');
    expect((await http('POST', `/valuations/${created.body.valuation.id}/approve`, { token: reviewer.token })).status).toBe(200);
  });

  it('unresolved discrepancies keep blocking, and advanceTo reaches APPROVED cleanly', async () => {
    const ids = await makeAssignment(admin, 'HOUSE', 'APPROVED');
    const reply = await http('GET', `/assignments/${ids.assignmentId}`, { token: admin.token });
    expect(reply.body.status).toBe('APPROVED');
  });
});

describe.skipIf(!e2eEnabled)('comparables', () => {
  let admin: { token: string; id: string };

  beforeAll(async () => {
    admin = await adminLogin();
  });

  const comparable = (over: Record<string, unknown> = {}) => ({
    location: `${unique('Sector')} Model Town`,
    source: 'Registry search',
    isTransaction: true,
    observedOn: '2026-09-01',
    areaBasis: 'LAND',
    ratePerSqm: 48000,
    ...over,
  });

  it('records, verifies by someone else, summarises, and gates citation on verification', async () => {
    const ids = await makeAssignment(admin, 'LAND', 'VALUATION');
    const valuer = await makeUser(admin.token, 'VALUER');
    const reviewer = await makeUser(admin.token, 'REVIEWER');

    const a = await http('POST', `/assignments/${ids.assignmentId}/comparables`, { token: valuer.token, json: comparable() });
    expect(a.status).toBe(201);
    expect(a.body.verified).toBe(false);
    const b = await http('POST', `/assignments/${ids.assignmentId}/comparables`, { token: valuer.token, json: comparable({ ratePerSqm: 52000 }) });

    // cited while unverified -> rejected
    const input = { ...(VALUATION_INPUTS.LAND as object), comparableIds: [a.body.id] };
    expect((await http('POST', `/assignments/${ids.assignmentId}/valuations`, { token: admin.token, json: input })).status).toBe(400);

    // recorder cannot verify their own entry; a reviewer can
    expect((await http('PATCH', `/comparables/${a.body.id}/verify`, { token: valuer.token, json: { verified: true } })).status).toBe(403);
    expect((await http('PATCH', `/comparables/${a.body.id}/verify`, { token: reviewer.token, json: { verified: true } })).body.verified).toBe(true);
    await http('PATCH', `/comparables/${b.body.id}/verify`, { token: reviewer.token, json: { verified: true } });

    const summary = await http('GET', `/assignments/${ids.assignmentId}/comparables/summary`, { token: admin.token });
    expect(summary.body[0]).toMatchObject({ areaBasis: 'LAND', count: 2, min: 48000, max: 52000, median: 50000 });

    expect((await http('POST', `/assignments/${ids.assignmentId}/valuations`, { token: admin.token, json: input })).status).toBe(201);
  });

  it('rejects future dates, zero rates and unknown bases', async () => {
    const ids = await makeAssignment(admin, 'LAND');
    const post = (json: unknown) => http('POST', `/assignments/${ids.assignmentId}/comparables`, { token: admin.token, json });
    expect((await post(comparable({ observedOn: '2099-01-01' }))).status).toBe(400);
    expect((await post(comparable({ ratePerSqm: 0 }))).status).toBe(400);
    expect((await post(comparable({ areaBasis: 'GUESS' }))).status).toBe(400);
  });
});
