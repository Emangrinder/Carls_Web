-- Tracks when the nflverse ETL pipeline (.github/workflows/nflverse-etl.yml,
-- runs daily) last completed successfully. sync_to_supabase.py writes this
-- row as its very last step, after every table load and materialized view
-- refresh -- so a fresh last_synced_at is proof the whole nightly pipeline
-- finished, not just that the workflow started.
--
-- Singleton table: exactly one row, upserted in place each run rather than
-- appended, since only the most recent sync time matters to readers.

create table sync_log (
    id             boolean primary key default true,
    last_synced_at timestamptz not null,
    constraint sync_log_singleton check (id)
);

alter table sync_log enable row level security;
create policy "Public read access" on sync_log for select to anon, authenticated using (true);
grant select on sync_log to anon, authenticated;
