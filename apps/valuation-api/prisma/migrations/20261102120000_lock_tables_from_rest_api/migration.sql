-- Supabase publishes every table in the public schema through its own REST API,
-- reachable with the project's public key. This API is the only intended way into
-- the data (it filters every query by firm), so shut that second door: turn on
-- row-level security with no policies, and take away the public roles' grants.
--
-- The API connects as the table owner, which row-level security does not apply
-- to, so nothing changes for it. On a plain Postgres the Supabase roles do not
-- exist and only the row-level security part runs.
--
-- Every later migration that creates a table must turn row-level security on for
-- it too; a test (migrations-rls.spec.ts) fails if one forgets.
DO $$
DECLARE
  t record;
  r text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;

  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', r);
    END IF;
  END LOOP;
END
$$;
