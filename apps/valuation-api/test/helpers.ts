import { crc32, deflateSync } from 'node:zlib';
import { PDFDocument } from 'pdf-lib';

// Shared client for the e2e specs. They need a running API plus a seeded admin:
//   E2E_BASE_URL=http://localhost:3100/api/v1 SEED_ADMIN_EMAIL=… SEED_ADMIN_PASSWORD=… npm run test:e2e
export const BASE = process.env.E2E_BASE_URL;
export const e2eEnabled = Boolean(BASE);

export interface Reply<T = any> {
  status: number;
  body: T;
}

export async function http<T = any>(
  method: string,
  path: string,
  options: { token?: string; json?: unknown; form?: FormData } = {},
): Promise<Reply<T>> {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(options.token && { Authorization: `Bearer ${options.token}` }),
      ...(options.json !== undefined && { 'Content-Type': 'application/json' }),
    },
    body: options.form ?? (options.json !== undefined ? JSON.stringify(options.json) : undefined),
  });
  const text = await response.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // not JSON (a file download)
  }
  return { status: response.status, body: body as T };
}

export async function login(email: string, password: string) {
  const reply = await http('POST', '/auth/login', { json: { email, password } });
  if (reply.status !== 200) throw new Error(`login failed for ${email}: ${reply.status}`);
  return { token: reply.body.accessToken as string, id: reply.body.user.id as string };
}

export const adminLogin = () =>
  login(process.env.SEED_ADMIN_EMAIL ?? 'admin@example.com', process.env.SEED_ADMIN_PASSWORD ?? '');

export const unique = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 8)}`;

export async function makeUser(adminToken: string, role: string, fullName = `E2E ${role}`) {
  const email = `${unique(role.toLowerCase())}@example.com`;
  const password = 'e2e-password-123456';
  const created = await http('POST', '/users', { token: adminToken, json: { email, fullName, role, password } });
  if (created.status !== 201) throw new Error(`could not create ${role}: ${created.status} ${JSON.stringify(created.body)}`);
  const session = await login(email, password);
  return { ...session, email, password };
}

// A genuine one-page PDF, so it can be merged into a report package.
export async function realPdf(text = 'sample deed'): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([300, 200]).drawText(text, { x: 20, y: 100, size: 14 });
  return doc.save();
}

// A one-page PDF with a real text layer, one drawn line per entry.
export async function textPdf(lines: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  lines.forEach((line, i) => page.drawText(line, { x: 40, y: 780 - i * 18, size: 11 }));
  return doc.save();
}

export async function uploadTextDocument(token: string, propertyId: string, type: string, lines: string[], extra: Record<string, string> = {}) {
  const form = new FormData();
  form.set('type', type);
  form.set('pageCount', '1');
  for (const [key, value] of Object.entries(extra)) form.set(key, value);
  form.set('file', new Blob([await textPdf(lines)], { type: 'application/pdf' }), 'deed-text.pdf');
  const reply = await http('POST', `/properties/${propertyId}/documents`, { token, form });
  if (reply.status !== 201) throw new Error(`upload failed: ${reply.status} ${JSON.stringify(reply.body)}`);
  return reply.body;
}

export function tinyPng(): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), 8 + data.length);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(1, 0);
  header.writeUInt32BE(1, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.from([0, 255, 0, 0]))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export async function pdfForm(extra: Record<string, string> = {}, text = 'sample deed') {
  const form = new FormData();
  for (const [key, value] of Object.entries(extra)) form.set(key, value);
  form.set('file', new Blob([await realPdf(text)], { type: 'application/pdf' }), 'deed.pdf');
  return form;
}

export async function uploadDocument(token: string, propertyId: string, type = 'SALE_DEED', extra: Record<string, string> = {}) {
  const reply = await http('POST', `/properties/${propertyId}/documents`, { token, form: await pdfForm({ type, pageCount: '1', ...extra }) });
  if (reply.status !== 201) throw new Error(`upload failed: ${reply.status} ${JSON.stringify(reply.body)}`);
  return reply.body;
}

export const VALUATION_INPUTS: Record<string, unknown> = {
  COMMERCIAL: {
    areaSource: 'Sale deed',
    commercialMethod: 'INCOME',
    areaBasis: 'BUILT_UP',
    unit: { areaSqm: 50, ratePerSqm: 100000, rateSource: 'Shops in the same row' },
    income: { monthlyRent: 50000, rentSource: 'Lease dated Jan 2026', vacancyPercent: 10, operatingExpensePercent: 20, capRatePercent: 8, capRateSource: 'Market yield survey' },
  },
  INDUSTRIAL: {
    areaSource: 'Lease deed',
    land: { areaSqm: 1000, ratePerSqm: 10000, rateSource: 'Industrial plots nearby' },
    floors: [{ label: 'Main shed', areaSqm: 500, constructionRatePerSqm: 15000, rateSource: 'PWD schedule', ageYears: 10, usefulLifeYears: 50, residualPercent: 10 }],
    scopeIncludesPlant: true,
    plant: [{ item: 'CNC lathe', quantity: 2, unitCost: 1000000, source: 'Supplier invoices', ageYears: 5, usefulLifeYears: 20, residualPercent: 10 }],
  },
  MIXED_USE: {
    areaSource: 'Sanctioned plan',
    sanctionedPlanRef: 'Plan 114/2025 dated 3 Mar 2025',
    components: [
      { label: 'Tower A flats', use: 'RESIDENTIAL', areaSqm: 1000, ratePerSqm: 50000, rateSource: 'Launch price list', completionPercent: 60 },
      { label: 'Retail podium', use: 'COMMERCIAL', areaSqm: 200, ratePerSqm: 100000, rateSource: 'Nearby shops', completionPercent: 100 },
    ],
  },
  LAND: { areaSource: 'Revenue record', land: { areaSqm: 100, ratePerSqm: 50000, rateSource: 'Comparables A, B' } },
  FLAT: {
    areaSource: 'Builder agreement',
    areaBasis: 'CARPET',
    rateBasis: 'CARPET',
    unit: { areaSqm: 80, ratePerSqm: 60000, rateSource: 'Society sale 2026' },
  },
  HOUSE: {
    areaSource: 'Deed and site agree',
    land: { areaSqm: 100, ratePerSqm: 50000, rateSource: 'Comparables A, B' },
    floors: [{ label: 'Ground floor', areaSqm: 100, constructionRatePerSqm: 20000, rateSource: 'PWD schedule', ageYears: 10, usefulLifeYears: 50, residualPercent: 10 }],
  },
};

const ANNEXURES: Record<string, string[]> = { FLAT: [], HOUSE: ['APPROVED_PLAN'], LAND: ['REVENUE_RECORD'], COMMERCIAL: [], INDUSTRIAL: ['APPROVED_PLAN'], MIXED_USE: ['APPROVED_PLAN'] };

// Installs the standard templates, attaches what the template requires, then
// drafts, reviews and approves a report that passes QC.
export async function prepareApprovedReport(admin: { token: string; id: string }, ids: Ids) {
  await http('POST', '/report-templates/install-defaults', { token: admin.token });
  for (const type of ANNEXURES[ids.propertyClass] ?? []) await uploadDocument(admin.token, ids.propertyId, type);

  const templates = await http('GET', `/assignments/${ids.assignmentId}/report-templates`, { token: admin.token });
  const templateId = templates.body.find((t: any) => t.propertyClass === ids.propertyClass).id;
  const created = await http('POST', `/assignments/${ids.assignmentId}/reports`, { token: admin.token, json: { templateId } });
  if (created.status !== 201) throw new Error(`report failed: ${JSON.stringify(created.body)}`);
  const failed = created.body.qc.checks.filter((c: any) => c.status === 'FAIL');
  if (failed.length) throw new Error(`report QC failed: ${JSON.stringify(failed)}`);
  await http('POST', `/reports/${created.body.id}/submit-for-review`, { token: admin.token });
  const approved = await http('POST', `/reports/${created.body.id}/approve`, { token: admin.token });
  if (approved.status !== 200) throw new Error(`report approve failed: ${JSON.stringify(approved.body)}`);
  return created.body.id as string;
}

export const STAGES = ['DOCUMENTS', 'INSPECTION', 'VALUATION', 'QUALITY_REVIEW', 'APPROVED'] as const;
export type Stage = 'INTAKE' | (typeof STAGES)[number];

export interface Ids {
  bankId: string;
  propertyId: string;
  assignmentId: string;
  propertyClass: string;
}

// Moves an assignment forward through the real gates, doing the work each one
// asks for (a document, a submitted inspection, a valuation in review...).
export async function advanceTo(admin: { token: string; id: string }, ids: Ids, stage: Stage) {
  const target = stage === 'INTAKE' ? -1 : STAGES.indexOf(stage);
  const move = async (status: string) => {
    const moved = await http('PATCH', `/assignments/${ids.assignmentId}/status`, { token: admin.token, json: { status } });
    if (moved.status !== 200) throw new Error(`could not move to ${status}: ${JSON.stringify(moved.body)}`);
  };
  const valuer = target >= 2 ? await makeUser(admin.token, 'VALUER') : null;

  for (let i = 0; i <= target; i += 1) {
    const next = STAGES[i];
    if (next === 'INSPECTION') await uploadDocument(admin.token, ids.propertyId, 'SALE_DEED', { assignmentId: ids.assignmentId });
    if (next === 'VALUATION' && valuer) {
      const visit = await http('POST', `/assignments/${ids.assignmentId}/inspections`, {
        token: admin.token,
        json: { inspectorId: valuer.id, visitedAt: '2026-10-21T10:00:00Z' },
      });
      await http('POST', `/inspections/${visit.body.id}/measurements`, { token: valuer.token, json: { label: 'Plot', areaSqm: 100, method: 'tape' } });
      const photoForm = new FormData();
      photoForm.set('caption', 'Front elevation');
      photoForm.set('file', new Blob([tinyPng()], { type: 'image/png' }), 'front.png');
      const photo = await http('POST', `/inspections/${visit.body.id}/photos`, { token: valuer.token, form: photoForm });
      await http('PATCH', `/inspection-photos/${photo.body.id}`, { token: valuer.token, json: { captionConfirmed: true } });
      const submitted = await http('POST', `/inspections/${visit.body.id}/submit`, { token: valuer.token });
      if (submitted.status !== 201) throw new Error(`inspection submit failed: ${JSON.stringify(submitted.body)}`);
    }
    if (next === 'QUALITY_REVIEW' || next === 'APPROVED') {
      if (next === 'QUALITY_REVIEW') {
        const created = await http('POST', `/assignments/${ids.assignmentId}/valuations`, { token: admin.token, json: VALUATION_INPUTS[ids.propertyClass] });
        if (created.status !== 201) throw new Error(`valuation failed: ${JSON.stringify(created.body)}`);
        await http('POST', `/valuations/${created.body.valuation.id}/submit-for-review`, { token: admin.token });
      } else {
        const list = await http('GET', `/assignments/${ids.assignmentId}/valuations`, { token: admin.token });
        await http('POST', `/valuations/${list.body[0].id}/approve`, { token: admin.token });
        await prepareApprovedReport(admin, ids);
      }
    }
    await move(next);
  }
  return ids;
}

// A bank, a property of the given class, and an assignment advanced to `stage`.
export async function makeAssignment(admin: { token: string; id: string }, propertyClass: string, stage: Stage = 'INTAKE') {
  const bank = await http('POST', '/banks', { token: admin.token, json: { name: unique('Bank') } });
  const property = await http('POST', '/properties', {
    token: admin.token,
    json: { propertyClass, addressLine: `${unique('Plot')} Model Town, Panipat`, district: 'Panipat', khasraNumbers: [unique('k')] },
  });
  const assignment = await http('POST', '/assignments', {
    token: admin.token,
    json: {
      bankId: bank.body.id,
      propertyId: property.body.id,
      assignedValuerId: admin.id,
      purpose: 'Home loan',
      valuationDate: '2026-10-22',
      dueDate: '2030-12-30',
    },
  });
  const ids: Ids = { bankId: bank.body.id, propertyId: property.body.id, assignmentId: assignment.body.id, propertyClass };
  return advanceTo(admin, ids, stage);
}
