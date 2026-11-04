import { beforeAll, describe, expect, it } from 'vitest';
import { adminLogin, e2eEnabled, http, makeAssignment, VALUATION_INPUTS } from './helpers.js';

describe.skipIf(!e2eEnabled)('every property class goes from valuation to an approved report', () => {
  let admin: { token: string; id: string };

  beforeAll(async () => {
    admin = await adminLogin();
  });

  const expected: Record<string, number> = {
    FLAT: 4_800_000,
    HOUSE: 6_600_000,
    LAND: 5_000_000,
    COMMERCIAL: 5_400_000,
    INDUSTRIAL: 17_500_000,
    MIXED_USE: 50_000_000,
  };

  for (const [propertyClass, total] of Object.entries(expected)) {
    it(`${propertyClass}: engine total ${total.toLocaleString('en-IN')}, report QC passes, assignment reaches APPROVED`, async () => {
      const ids = await makeAssignment(admin, propertyClass, 'APPROVED');
      const valuations = await http('GET', `/assignments/${ids.assignmentId}/valuations`, { token: admin.token });
      expect(Number(valuations.body[0].totalValue)).toBe(total);
      expect(valuations.body[0].engineVersion).toMatch(/^property-engines\//);
      const reports = await http('GET', `/assignments/${ids.assignmentId}/reports`, { token: admin.token });
      expect(reports.body[0].qc.passed).toBe(true);
      expect((await http('GET', `/assignments/${ids.assignmentId}`, { token: admin.token })).body.status).toBe('APPROVED');
    });
  }

  it('a class with the wrong inputs is explained, not silently calculated', async () => {
    const ids = await makeAssignment(admin, 'INDUSTRIAL', 'VALUATION');
    const bad = await http('POST', `/assignments/${ids.assignmentId}/valuations/preview`, { token: admin.token, json: { ...(VALUATION_INPUTS.INDUSTRIAL as object), scopeIncludesPlant: undefined } });
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.body)).toMatch(/scope/);
  });
});
