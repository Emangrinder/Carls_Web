-- Current head coach / OC / DC per team, plus the year each was hired.
-- Manually curated, updated occasionally -- see
-- etl/data/player_management/active/build_coaching_staff.py.

create table current_coaching_staff (
    team        text not null,
    role        text not null check (role in ('HC', 'OC', 'DC')),
    coach_name  text not null,
    since_year  integer,
    primary key (team, role)
);

alter table current_coaching_staff enable row level security;
create policy "Public read access" on current_coaching_staff for select to anon, authenticated using (true);
grant select on current_coaching_staff to anon, authenticated;
