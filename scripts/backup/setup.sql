-- The role the backup job dumps the database as (docs/runbooks/backup.md, "Setting it up").
-- Run once in Supabase → SQL Editor, as postgres, with a password of your own in place of
-- <password> (`openssl rand -hex 24`); then the job's BACKUP_DATABASE_URL is
--   postgresql://backup_reader.<project ref>:<password>@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres
--
-- Not a migration: a role with a password belongs to one environment, not to the schema.
--
-- It can read everything the dump holds and change nothing. BYPASSRLS because every table has RLS
-- on and no policies (CLAUDE.md), and pg_dump refuses a table that RLS would filter.

create role backup_reader login bypassrls password '<password>';
-- A dump is one long read; nothing else.
alter role backup_reader set default_transaction_read_only = on;
alter role backup_reader set statement_timeout = '10min';

grant usage on schema public, app, drizzle to backup_reader;
grant select on all tables in schema public, app, drizzle to backup_reader;
grant select on all sequences in schema public, app, drizzle to backup_reader;
-- Tables and sequences the migrations add later (they run as postgres).
alter default privileges for role postgres in schema public, app, drizzle grant select on tables to backup_reader;
alter default privileges for role postgres in schema public, app, drizzle grant select on sequences to backup_reader;
