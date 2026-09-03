-- Adds wr1_wr2_target_pct_diff to team_share_stats: the gap between the
-- team's top individual WR's target share and its 2nd WR's target share
-- (both as % of total team targets, same basis as qb_share_pct) -- a
-- concentration signal distinct from wr_target_pct, which is the WR
-- *position group's* aggregate share of targets, not any one player's.

drop materialized view if exists team_share_stats;

create materialized view team_share_stats as
with qb as (
    select pos.team, pos.season,
        max(pos.attempts) as top_qb_attempts,
        sum(pos.attempts) as total_qb_attempts
    from player_season_offense_stats pos
    join players pl on pl.player_id = pos.player_id
    where pl.position = 'QB'
    group by pos.team, pos.season
),
targets as (
    select pos.team, pos.season,
        sum(pos.targets) filter (where pl.position = 'WR') as wr_targets,
        sum(pos.targets) filter (where pl.position = 'TE') as te_targets,
        sum(pos.targets) filter (where pl.position = 'RB') as rb_targets,
        sum(pos.targets) as total_targets
    from player_season_offense_stats pos
    join players pl on pl.player_id = pos.player_id
    group by pos.team, pos.season
),
wr_by_player as (
    select pos.team, pos.season, pos.player_id, sum(pos.targets) as targets
    from player_season_offense_stats pos
    join players pl on pl.player_id = pos.player_id
    where pl.position = 'WR'
    group by pos.team, pos.season, pos.player_id
),
wr_ranked as (
    select team, season, player_id, targets,
        row_number() over (partition by team, season order by targets desc) as rn
    from wr_by_player
),
wr_top2 as (
    select team, season,
        max(targets) filter (where rn = 1) as wr1_targets,
        max(targets) filter (where rn = 2) as wr2_targets
    from wr_ranked
    group by team, season
),
rb_carries as (
    select pos.team, pos.season, pos.player_id, sum(pos.carries) as carries
    from player_season_offense_stats pos
    join players pl on pl.player_id = pos.player_id
    where pl.position = 'RB'
    group by pos.team, pos.season, pos.player_id
),
rb_ranked as (
    select team, season, player_id, carries,
        row_number() over (partition by team, season order by carries desc) as rn
    from rb_carries
),
rb_share as (
    select team, season,
        sum(carries) as total_rb_carries,
        max(carries) filter (where rn = 1) as rb1_carries,
        max(carries) filter (where rn = 2) as rb2_carries
    from rb_ranked
    group by team, season
),
kr as (
    select pos.team, pos.season, pos.player_id, sum(pos.kickoff_returns) as kr
    from player_season_special_teams_stats pos
    group by pos.team, pos.season, pos.player_id
),
kr_share as (
    select team, season, max(kr) as top_kr, sum(kr) as total_kr
    from kr group by team, season
),
pr as (
    select pos.team, pos.season, pos.player_id, sum(pos.punt_returns) as pr
    from player_season_special_teams_stats pos
    group by pos.team, pos.season, pos.player_id
),
pr_share as (
    select team, season, max(pr) as top_pr, sum(pr) as total_pr
    from pr group by team, season
)
select
    ts.team, ts.season, ts.conference,
    round(100.0 * q.top_qb_attempts / nullif(q.total_qb_attempts, 0), 1) as qb_share_pct,
    round(100.0 * tg.wr_targets / nullif(tg.total_targets, 0), 1) as wr_target_pct,
    round(100.0 * tg.te_targets / nullif(tg.total_targets, 0), 1) as te_target_pct,
    round(100.0 * tg.rb_targets / nullif(tg.total_targets, 0), 1) as rb_target_pct,
    round(100.0 * (wr.wr1_targets - wr.wr2_targets) / nullif(tg.total_targets, 0), 1) as wr1_wr2_target_pct_diff,
    round(100.0 * rb.rb1_carries / nullif(rb.total_rb_carries, 0), 1) as rb1_carry_pct,
    round(100.0 * rb.rb2_carries / nullif(rb.total_rb_carries, 0), 1) as rb2_carry_pct,
    round(100.0 * k.top_kr / nullif(k.total_kr, 0), 1) as kr_share_pct,
    round(100.0 * p.top_pr / nullif(p.total_pr, 0), 1) as pr_share_pct
from (select team, season, conference from team_season_stats) ts
left join qb q on q.team = ts.team and q.season = ts.season
left join targets tg on tg.team = ts.team and tg.season = ts.season
left join wr_top2 wr on wr.team = ts.team and wr.season = ts.season
left join rb_share rb on rb.team = ts.team and rb.season = ts.season
left join kr_share k on k.team = ts.team and k.season = ts.season
left join pr_share p on p.team = ts.team and p.season = ts.season;

create unique index team_share_stats_pk on team_share_stats (team, season);
grant select on team_share_stats to anon, authenticated;
