# valuation-api (ValueHub OS)

NestJS + Prisma API for the Valuation Operating System. Independent of `apps/api`
(the older Valuer Connect app): own Postgres database, own Prisma client (generated into
`src/generated/prisma`, gitignored), own JWT auth. See `docs/valuehub-os.md` for the
product overview, roles, workflow and operations.

## Setup

```bash
cp .env.example .env     # DATABASE_URL, JWT_SECRET (32+ chars), SEED_ADMIN_PASSWORD, optional SMTP_*
npm install              # from the project root; runs prisma generate
npm run db:deploy      # apply migrations
npm run db:seed        # first firm + admin
npm run dev            # shared build + api (3100) + web (5174)
```

## Tests

```bash
npm test                                     # unit tests (engines, QC, parsing, money, throttle…)
# end-to-end: against a running API on a seeded database
E2E_BASE_URL=http://localhost:3100/api/v1 SEED_ADMIN_EMAIL=… SEED_ADMIN_PASSWORD=… \
  npm run test:e2e
# optional: E2E_SMTP_SINK_URL=<http endpoint listing mail received by the SMTP the API uses>
#           enables the email and password-reset assertions
```

The e2e specs create their own banks, properties, assignments and users, so they can be re-run
against the same database.

## Modules

auth · users · banks · properties · assignments (gated workflow) · documents (+ OCR) ·
inspections · discrepancies · comparables · valuations (6 property-class engines) ·
reports (templates, QC, PDF, issue) · submissions (+ email) · queries & revisions ·
accounts (invoices, payments, follow-ups) · dashboard & reminders · search · dossier export ·
admin config (fees, checklist, retention, legal hold) · audit.
