// Re-hashes every stored file and compares it with the hash recorded when it
// was uploaded. Run after a restore, or on a schedule, to catch missing or
// altered files. Exits non-zero if anything differs.
import { createHash } from 'node:crypto';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { StorageService } from '../src/common/storage/storage.service.js';

// Works for the local disk and for Supabase Storage alike, whichever the environment selects.
const storage = new StorageService();
const prisma = new PrismaClient();
const problems: string[] = [];
let checked = 0;

async function check(label: string, storageKey: string, sha256: string) {
  checked += 1;
  try {
    const digest = createHash('sha256').update(await storage.read(storageKey)).digest('hex');
    if (digest !== sha256) problems.push(`${label}: hash differs`);
  } catch {
    problems.push(`${label}: file missing`);
  }
}

try {
  const BATCH = 500;
  for (let skip = 0; ; skip += BATCH) {
    const rows = await prisma.document.findMany({ select: { id: true, fileName: true, storageKey: true, sha256: true }, orderBy: { id: 'asc' }, skip, take: BATCH });
    for (const d of rows) await check(`document ${d.id} (${d.fileName})`, d.storageKey, d.sha256);
    if (rows.length < BATCH) break;
  }
  for (let skip = 0; ; skip += BATCH) {
    const rows = await prisma.inspectionPhoto.findMany({ select: { id: true, storageKey: true, sha256: true }, orderBy: { id: 'asc' }, skip, take: BATCH });
    for (const p of rows) await check(`photo ${p.id}`, p.storageKey, p.sha256);
    if (rows.length < BATCH) break;
  }
  for (let skip = 0; ; skip += BATCH) {
    const rows = await prisma.reportVersion.findMany({ select: { id: true, assignmentId: true, versionNumber: true, storageKey: true, sha256: true }, orderBy: { id: 'asc' }, skip, take: BATCH });
    for (const r of rows) await check(`report ${r.assignmentId} R${r.versionNumber}`, r.storageKey, r.sha256);
    if (rows.length < BATCH) break;
  }
} finally {
  await prisma.$disconnect();
}

console.log(`Checked ${checked} file(s); ${problems.length} problem(s).`);
for (const problem of problems) console.log(` - ${problem}`);
process.exit(problems.length > 0 ? 1 : 0);
