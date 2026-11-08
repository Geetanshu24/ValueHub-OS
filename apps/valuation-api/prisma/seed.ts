// Creates the first firm and admin so the API can be logged into, plus the default banks.
// Usage: npm run db:seed (reads SEED_* from .env). Safe to re-run.
import { randomBytes, scrypt as scryptCb } from 'node:crypto';
import { promisify } from 'node:util';
import { PrismaClient } from '../src/generated/prisma/client.js';

const scrypt = promisify(scryptCb) as (p: string, s: Buffer, k: number) => Promise<Buffer>;

const firmName = process.env.SEED_FIRM_NAME ?? 'Demo Valuation Firm';
const email = process.env.SEED_ADMIN_EMAIL?.toLowerCase();
const password = process.env.SEED_ADMIN_PASSWORD;

if (!email || !password || password.length < 12) {
  throw new Error('Set SEED_ADMIN_EMAIL and SEED_ADMIN_PASSWORD (12+ characters) in .env');
}

const salt = randomBytes(16);
const hash = await scrypt(password, salt, 64);
const passwordHash = `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;

const prisma = new PrismaClient();
try {
  let firmId: string;
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    firmId = existing.firmId;
    console.log(`Admin ${email} already exists; skipping firm and admin.`);
  } else {
    const firm = await prisma.firm.create({ data: { name: firmName } });
    firmId = firm.id;
    await prisma.user.create({
      data: { firmId, email, fullName: 'Firm Admin', role: 'FIRM_ADMIN', passwordHash },
    });
    console.log(`Created firm "${firmName}" with admin ${email}.`);
  }

  // The banks that have a report format built in, so the Bank list is never empty.
  for (const name of ['Bank of India', 'Punjab National Bank', 'State Bank of India']) {
    await prisma.bank.upsert({ where: { firmId_name: { firmId, name } }, update: {}, create: { firmId, name } });
  }
  console.log('Default banks ready: Bank of India, Punjab National Bank, State Bank of India.');
} finally {
  await prisma.$disconnect();
}
