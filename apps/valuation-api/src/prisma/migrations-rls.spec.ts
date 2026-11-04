import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = join(process.cwd(), 'prisma/migrations');
const LOCKDOWN = '20261102120000_lock_tables_from_rest_api';

const migrations = readdirSync(dir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort()
  .map((name) => ({ name, sql: readFileSync(join(dir, name, 'migration.sql'), 'utf8') }));

describe('row-level security on every table', () => {
  it('has the lockdown migration, which enables it for all earlier tables', () => {
    const found = migrations.find((m) => m.name === LOCKDOWN);
    expect(found).toBeDefined();
    expect(found?.sql).toContain('ENABLE ROW LEVEL SECURITY');
  });

  it('turns it on for any table created after the lockdown', () => {
    const after = migrations.filter((m) => m.name > LOCKDOWN);
    for (const migration of after) {
      const created = [...migration.sql.matchAll(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?"?([A-Za-z0-9_]+)"?/gi)].map((m) => m[1]);
      for (const table of created) {
        const secured = new RegExp(`ALTER TABLE\\s+(?:ONLY\\s+)?(?:"?public"?\\.)?"?${table}"?\\s+ENABLE ROW LEVEL SECURITY`, 'i').test(migration.sql);
        expect(secured, `${migration.name} creates ${table} without ENABLE ROW LEVEL SECURITY`).toBe(true);
      }
    }
  });
});
