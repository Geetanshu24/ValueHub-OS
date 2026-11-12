import { beforeAll, describe, expect, it } from 'vitest';
import { adminLogin, e2eEnabled, http, makeUser, unique } from './helpers.js';

describe.skipIf(!e2eEnabled)('case intake details', () => {
  let admin: { token: string; id: string };

  beforeAll(async () => {
    admin = await adminLogin();
  });

  async function base() {
    const bank = await http('POST', '/banks', { token: admin.token, json: { name: unique('Bank') } });
    const property = await http('POST', '/properties', { token: admin.token, json: { propertyClass: 'HOUSE', addressLine: `${unique('Plot')} Sector 15, Rohini`, district: 'Delhi', latitude: 28.7041, longitude: 77.1025 } });
    return { bankId: bank.body.id, propertyId: property.body.id };
  }

  it('keeps the officer, loan, applicant, billing, area and assigned inspector on the case', async () => {
    const ids = await base();
    const inspector = await makeUser(admin.token, 'INSPECTOR');
    const made = await http('POST', '/assignments', {
      token: admin.token,
      json: {
        ...ids, assignedValuerId: admin.id, purpose: 'Loan Against Property (LAP)', valuationDate: '2026-10-22', dueDate: '2030-12-30',
        borrowerName: 'Ramesh Kumar Gupta', bankOfficerName: 'Rajesh Verma', bankOfficerMobile: '+91-98110-12345', loanAccountNo: 'SBIHL20268849',
        applicantFatherName: 'Mahesh Prasad Gupta', applicantMobile: '+91-98110-45678', applicantEmail: 'ramesh@example.com',
        billingArrangement: 'Borrower Cash/NEFT on Site', specialInstructions: 'Verify road width', approxAreaSqm: 167.22, assignedInspectorId: inspector.id,
      },
    });
    expect(made.status).toBe(201);
    const got = await http('GET', `/assignments/${made.body.id}`, { token: admin.token });
    expect(got.body).toMatchObject({ bankOfficerName: 'Rajesh Verma', loanAccountNo: 'SBIHL20268849', applicantEmail: 'ramesh@example.com', billingArrangement: 'Borrower Cash/NEFT on Site' });
    expect(Number(got.body.approxAreaSqm)).toBeCloseTo(167.22, 2);
    expect(got.body.assignedInspector.id).toBe(inspector.id);
  });

  it('rejects a bad email and an inspector from nowhere', async () => {
    const ids = await base();
    const body = { ...ids, assignedValuerId: admin.id, purpose: 'Home loan', valuationDate: '2026-10-22', dueDate: '2030-12-30' };
    const badEmail = await http('POST', '/assignments', { token: admin.token, json: { ...body, applicantEmail: 'not-an-email' } });
    expect(badEmail.status).toBe(400);
    const stranger = await http('POST', '/assignments', { token: admin.token, json: { ...body, assignedInspectorId: '00000000-0000-4000-8000-000000000000' } });
    expect(stranger.status).toBe(400);
  });
});
