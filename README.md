# ValueHub OS

Valuation Operating System: one connected system for the bank valuation workflow — assignment
intake, property identity, documents and OCR, site inspection, valuation engines, bank-format
reports with quality checks, submission, revisions and queries, accounts, and a searchable
evidence vault.

```
apps/valuation-api      NestJS + Prisma (Postgres), port 3100
apps/valuation-web      React + Vite + Tailwind, port 5174
packages/valuation-shared   enums, workflow rules and ID formats shared by both
deploy/valuehub-os      Dockerfiles, docker-compose, backup and restore scripts
docs/valuehub-os.md     workflow, gates, roles, operations, known limits
```

## Run it locally

You need Node 20+ and a Postgres database.

```bash
docker run -d --name valuehub-db -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=valuehub_os -p 5432:5432 postgres:17-alpine
cp apps/valuation-api/.env.example apps/valuation-api/.env   # set DATABASE_URL, JWT_SECRET, SEED_ADMIN_PASSWORD
npm install
npm run db:deploy      # create the tables
npm run db:seed        # first firm + admin (admin@example.com)
npm run dev            # api on :3100, web on :5174
```

## Checks

```bash
npm run build && npm run lint && npm test
# end to end, against a running API and a seeded database:
E2E_BASE_URL=http://localhost:3100/api/v1 SEED_ADMIN_EMAIL=admin@example.com SEED_ADMIN_PASSWORD=<yours> npm run test:e2e
```

## Deploy

Supabase (database and files) + Render (API) + Vercel (web): `docs/deploy-supabase-render-vercel.md`.
Docker compose for a single server: `deploy/valuehub-os/`.

See `docs/valuehub-os.md` and `apps/valuation-api/README.md` for details.
