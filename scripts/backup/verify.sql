-- What a restored backup must answer before it counts (docs/BACKUP_PLAN.md §3.4). Run by
-- check-dump.sh on a throwaway database the dump was just restored into:
--
--   PGOPTIONS='-c backup.taken_at=<when the dump began>' psql -X -q -v ON_ERROR_STOP=1 -f verify.sql
--
-- A failed check stops with "backup check failed: <name>" and nothing else: the job's log is
-- public, so no check ever prints what it found. `backup.taken_at` (optional) is the dump's own
-- moment, which the freshness check measures from, so an old dump restored in a drill still passes.
--
-- tests/backup-verify.test.ts runs this file against the migrated schema with
-- `backup.check_mode = structure`: every query below is still planned and run — a migration that
-- renames a column checked here fails CI, not the night's backup — but the data checks, which an
-- empty test database cannot meet, do not stop it.

create or replace function pg_temp.backup_check(ok boolean, name text, kind text default 'data') returns void
language plpgsql as $$
begin
  if coalesce(ok, false) then return; end if;
  if kind = 'data' and current_setting('backup.check_mode', true) = 'structure' then return; end if;
  raise exception 'backup check failed: %', name;
end
$$;

-- The shape: the schemas, the extensions the tables are typed with, the migration journal.
select pg_temp.backup_check((select count(*) = 3 from pg_namespace where nspname in ('public', 'app', 'drizzle')), 'schemas', 'structure');
select pg_temp.backup_check((select count(*) = 2 from pg_extension where extname in ('vector', 'btree_gist')), 'extensions', 'structure');
select pg_temp.backup_check(to_regclass('drizzle.__drizzle_migrations') is not null, 'migration journal', 'structure');

-- The data: there is a company in it, and it is as recent as the dump says.
select pg_temp.backup_check((select count(*) > 0 from drizzle.__drizzle_migrations), 'migrations recorded');
select pg_temp.backup_check((select count(*) > 0 from public.person where status = 'active'), 'active people');
select pg_temp.backup_check((select count(*) > 0 from public.audit_log), 'audit log');
select pg_temp.backup_check((select count(*) > 0 from public.org_unit), 'organisation');
-- The scheduled jobs run every day, holidays included, so the newest run is never a day older than
-- the dump: an older one means the dump is of a stale database, or of the wrong one.
select pg_temp.backup_check(
  nullif(current_setting('backup.taken_at', true), '') is null
    or (select max(started_at) from public.job_run) > nullif(current_setting('backup.taken_at', true), '')::timestamptz - interval '26 hours',
  'freshness');
-- Every live file record names an object: the list the file backup is checked against.
select pg_temp.backup_check((select count(*) = count(object_path) from public.stored_file where status = 'ready' and purged_at is null), 'file records');
