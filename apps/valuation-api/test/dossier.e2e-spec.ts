import { beforeAll, describe, expect, it } from 'vitest';
import { BASE, adminLogin, e2eEnabled, http, makeAssignment, makeUser } from './helpers.js';

// Lists the file names in a zip by reading its central directory.
function zipNames(zip: Buffer): string[] {
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = zip.readUInt16LE(eocd + 10);
  let offset = zip.readUInt32LE(eocd + 16);
  const names: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const nameLength = zip.readUInt16LE(offset + 28);
    const extra = zip.readUInt16LE(offset + 30);
    const comment = zip.readUInt16LE(offset + 32);
    names.push(zip.subarray(offset + 46, offset + 46 + nameLength).toString());
    offset += 46 + nameLength + extra + comment;
  }
  return names;
}

describe.skipIf(!e2eEnabled)('evidence dossier', () => {
  let admin: { token: string; id: string };

  beforeAll(async () => {
    admin = await adminLogin();
  });

  const build = async (id: string, json: unknown, token = admin.token) => {
    const response = await fetch(`${BASE}/assignments/${id}/dossier`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(json) });
    return { status: response.status, bytes: Buffer.from(await response.arrayBuffer()) };
  };

  it('plans what can be exported, builds an indexed archive, and respects redactions', async () => {
    const ids = await makeAssignment(admin, 'LAND', 'APPROVED');
    const reports = await http('GET', `/assignments/${ids.assignmentId}/reports`, { token: admin.token });
    await http('POST', `/reports/${reports.body[0].id}/issue`, { token: admin.token });
    await http('POST', `/assignments/${ids.assignmentId}/submissions`, { token: admin.token, json: { reportVersionId: reports.body[0].id, channel: 'PORTAL', recipient: 'bank portal' } });
    await http('PATCH', `/assignments/${ids.assignmentId}`, { token: admin.token, json: { fee: 5000 } });
    await http('POST', `/assignments/${ids.assignmentId}/invoices`, { token: admin.token, json: { dueOn: '2030-01-01', amount: 5000 } });

    const plan = await http('GET', `/assignments/${ids.assignmentId}/dossier/plan`, { token: admin.token });
    const all: string[] = plan.body.map((p: any) => p.id);
    expect(all).toEqual(expect.arrayContaining(['audit', 'invoices', 'submissions']));
    expect(plan.body.find((p: any) => p.id === 'invoices').sensitive).toBe('fees');
    expect(plan.body.some((p: any) => p.id.startsWith('report:'))).toBe(true);

    const full = await build(ids.assignmentId, { items: all });
    expect(full.status).toBe(201);
    const names = zipNames(full.bytes);
    expect(names).toEqual(expect.arrayContaining(['00_INDEX.txt', 'manifest.json', 'accounts/invoices.json', 'trail/audit.json', 'correspondence/submissions.json']));
    expect(names.some((n) => n.startsWith('reports/') && n.endsWith('.pdf'))).toBe(true);
    expect(names.some((n) => n.startsWith('inspection/') && n.includes('/photos/'))).toBe(true);
    expect(names.some((n) => n.startsWith('documents/') && n.endsWith('.facts.json'))).toBe(true);

    const redacted = await build(ids.assignmentId, { items: all, redact: { fees: true, internal: true, gps: true } });
    const redactedNames = zipNames(redacted.bytes);
    expect(redactedNames).not.toContain('accounts/invoices.json');
    expect(redactedNames).not.toContain('trail/audit.json');
    expect(redactedNames).toContain('manifest.json');

    const trail = await http('GET', `/audit?entityId=${ids.assignmentId}`, { token: admin.token });
    expect(trail.body.items.filter((e: any) => e.action === 'dossier.exported')).toHaveLength(2);
  });

  it('rejects foreign or unknown items, empty selections, and outsiders', async () => {
    const a = await makeAssignment(admin, 'LAND', 'INSPECTION');
    const b = await makeAssignment(admin, 'LAND', 'INSPECTION');
    const planB = await http('GET', `/assignments/${b.assignmentId}/dossier/plan`, { token: admin.token });
    const foreign = planB.body.find((p: any) => p.id.startsWith('document:')).id;
    expect((await build(a.assignmentId, { items: [foreign] })).status).toBe(400);
    expect((await build(a.assignmentId, { items: ['nonsense'] })).status).toBe(400);
    expect((await build(a.assignmentId, { items: [] })).status).toBe(400);
    expect((await build(a.assignmentId, { items: ['audit'], redact: { internal: true } })).status).toBe(400); // nothing left

    const inspector = await makeUser(admin.token, 'INSPECTOR');
    expect((await build(a.assignmentId, { items: ['audit'] }, inspector.token)).status).toBe(403);
    expect((await http('GET', `/assignments/${a.assignmentId}/dossier/plan`, { token: inspector.token })).status).toBe(403);
  });
});
