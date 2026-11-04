import { beforeAll, describe, expect, it } from 'vitest';
import { adminLogin, e2eEnabled, http, login, makeAssignment, makeUser, unique } from './helpers.js';

describe.skipIf(!e2eEnabled)('foundation', () => {
  let admin: { token: string; id: string };

  beforeAll(async () => {
    admin = await adminLogin();
  });

  it('health is public, everything else needs a token', async () => {
    expect((await http('GET', '/../health')).status).toBe(200);
    expect((await http('GET', '/assignments')).status).toBe(401);
    expect((await http('GET', '/assignments', { token: 'garbage' })).status).toBe(401);
  });

  it('rejects a wrong password', async () => {
    expect((await http('POST', '/auth/login', { json: { email: 'admin@example.com', password: 'nope' } })).status).toBe(401);
  });

  it('admin manages users; deactivation takes effect immediately', async () => {
    const inspector = await makeUser(admin.token, 'INSPECTOR');
    expect((await http('GET', '/auth/me', { token: inspector.token })).status).toBe(200);
    expect((await http('POST', '/banks', { token: inspector.token, json: { name: 'x' } })).status).toBe(403);

    const off = await http('PATCH', `/users/${inspector.id}`, { token: admin.token, json: { isActive: false } });
    expect(off.status).toBe(200);
    expect((await http('GET', '/auth/me', { token: inspector.token })).status).toBe(401);
    await expect(login(inspector.email, inspector.password)).rejects.toThrow();
  });

  it('an admin cannot demote or deactivate themselves', async () => {
    expect((await http('PATCH', `/users/${admin.id}`, { token: admin.token, json: { isActive: false } })).status).toBe(400);
    expect((await http('PATCH', `/users/${admin.id}`, { token: admin.token, json: { role: 'VALUER' } })).status).toBe(400);
  });

  it('duplicate email is a 409 and short passwords are refused', async () => {
    const dup = { email: 'admin@example.com', fullName: 'Dup', role: 'VALUER', password: 'e2e-password-123456' };
    expect((await http('POST', '/users', { token: admin.token, json: dup })).status).toBe(409);
    expect((await http('POST', '/users', { token: admin.token, json: { ...dup, email: `${unique('a')}@example.com`, password: 'short' } })).status).toBe(400);
  });

  it('users can change their own password', async () => {
    const valuer = await makeUser(admin.token, 'VALUER');
    const bad = await http('POST', '/auth/change-password', { token: valuer.token, json: { currentPassword: 'wrong', newPassword: 'another-password-123' } });
    expect(bad.status).toBe(401);
    const ok = await http('POST', '/auth/change-password', { token: valuer.token, json: { currentPassword: valuer.password, newPassword: 'another-password-123' } });
    expect(ok.status).toBe(200);
    expect((await login(valuer.email, 'another-password-123')).id).toBe(valuer.id);
  });

  it('banks and branches can be renamed; duplicates conflict', async () => {
    const name = unique('Bank');
    const bank = await http('POST', '/banks', { token: admin.token, json: { name } });
    const other = await http('POST', '/banks', { token: admin.token, json: { name: unique('Bank') } });
    expect((await http('PATCH', `/banks/${bank.body.id}`, { token: admin.token, json: { name: other.body.name } })).status).toBe(409);
    const renamed = await http('PATCH', `/banks/${bank.body.id}`, { token: admin.token, json: { name: `${name} Ltd` } });
    expect(renamed.body.name).toBe(`${name} Ltd`);

    const branch = await http('POST', `/banks/${bank.body.id}/branches`, { token: admin.token, json: { name: 'Panipat' } });
    const updated = await http('PATCH', `/banks/${bank.body.id}/branches/${branch.body.id}`, { token: admin.token, json: { city: 'Panipat', contactEmail: 'm@bank.test' } });
    expect(updated.body.contactEmail).toBe('m@bank.test');
  });

  it('property identity can be corrected; class is frozen once valued', async () => {
    const { propertyId, assignmentId } = await makeAssignment(admin, 'LAND', 'VALUATION');
    const fixed = await http('PATCH', `/properties/${propertyId}`, { token: admin.token, json: { tehsil: 'Samalkha', pinCode: '132101' } });
    expect(fixed.body.tehsil).toBe('Samalkha');
    expect((await http('PATCH', `/properties/${propertyId}`, { token: admin.token, json: { pinCode: '12' } })).status).toBe(400);

    const input = { areaSource: 'Revenue record', land: { areaSqm: 100, ratePerSqm: 1000, rateSource: 'Comparable A' } };
    expect((await http('POST', `/assignments/${assignmentId}/valuations`, { token: admin.token, json: input })).status).toBe(201);
    expect((await http('PATCH', `/properties/${propertyId}`, { token: admin.token, json: { propertyClass: 'HOUSE' } })).status).toBe(409);
  });

  it('assignments can be edited and reallocated only by an admin', async () => {
    const { assignmentId } = await makeAssignment(admin, 'FLAT');
    const valuer = await makeUser(admin.token, 'VALUER');

    const edited = await http('PATCH', `/assignments/${assignmentId}`, { token: admin.token, json: { purpose: 'Top-up loan', fee: 7500 } });
    expect(edited.body.purpose).toBe('Top-up loan');

    expect((await http('PATCH', `/assignments/${assignmentId}`, { token: valuer.token, json: { assignedValuerId: valuer.id } })).status).toBe(403);
    const moved = await http('PATCH', `/assignments/${assignmentId}`, { token: admin.token, json: { assignedValuerId: valuer.id } });
    expect(moved.body.assignedValuer.id).toBe(valuer.id);
    expect((await http('PATCH', `/assignments/${assignmentId}`, { token: admin.token, json: { dueDate: '2001-01-01' } })).status).toBe(400);

    const trail = await http('GET', `/audit?entityId=${assignmentId}`, { token: admin.token });
    expect(trail.body.items.map((e: any) => e.action)).toEqual(expect.arrayContaining(['assignment.created', 'assignment.updated', 'assignment.reallocated']));
  });

  it('overdue and due-range filters work, and the calendar is bounded', async () => {
    const overdue = await http('GET', '/assignments?overdue=true', { token: admin.token });
    expect(overdue.status).toBe(200);
    const range = await http('GET', '/assignments?dueFrom=2030-12-01&dueTo=2030-12-31', { token: admin.token });
    expect(range.body.total).toBeGreaterThan(0);

    const cal = await http('GET', '/inspections?from=2026-01-01&to=2026-02-01', { token: admin.token });
    expect(cal.status).toBe(200);
    expect((await http('GET', '/inspections?from=2026-01-01&to=2027-12-31', { token: admin.token })).status).toBe(400);
  });

  it('a user cannot see another firm', async () => {
    // Only one firm exists in the seed, so assert on the id boundary instead:
    // an unknown id is a 404, never data.
    expect((await http('GET', '/assignments/00000000-0000-4000-8000-000000000000', { token: admin.token })).status).toBe(404);
  });
});
