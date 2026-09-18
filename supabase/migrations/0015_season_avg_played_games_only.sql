-- team_game_stats has one row per SCHEDULED REG game, not just played ones
-- (future weeks just coalesce every stat to 0 rather than being absent --
-- see 0006_defense_scores_share_stats.sql's team_games CTE). team_season_
-- stats' "for"/"against" CTEs ran avg(...) straight over those rows, so
-- every *_avg column (rush/pass/kick-return/punt-return yards, punts,
-- offense/defense snaps) was dividing by the full season length (e.g. 17)
-- instead of games actually played, even in the "for" GamePage.jsx's own
-- Season window (see its buildMatchOrder-era fix in GamePage.jsx) -- this
-- is the same bug at the database level, affecting every page that reads
-- team_season_stats directly (the home Yards table, TeamPage's Season
-- column, etc.), not just the one place already patched client-side.
--
-- Fix: join against games and restrict both CTEs to rows with a final
-- score, mirroring exactly what the record/scores CTEs already did
-- correctly. This is a no-op for the sum()-based columns (an unplayed
-- game already contributed 0) and only changes the avg() ones' denominator.

drop materialized view if exists team_share_stats;
drop materialized view if exists team_season_stats;

create materialized view team_season_stats as
with scores as (
    select game_id, season, game_type, home_team as team, away_team as opponent_team,
        home_score as points_for, away_score as points_against
    from games where home_score is not null and away_score is not null
    union all
    select game_id, season, game_type, away_team as team, home_team as opponent_team,
        away_score as points_for, home_score as points_against
    from games where home_score is not null and away_score is not null
),
record as (
    select team, season,
        count(*) filter (where game_type = 'REG') as games_played,
        count(*) filter (where game_type = 'REG' and points_for > points_against) as wins,
        count(*) filter (where game_type = 'REG' and points_for < points_against) as losses,
        count(*) filter (where game_type = 'REG' and points_for = points_against) as ties,
        sum(points_for) filter (where game_type = 'REG') as points_for,
        sum(points_against) filter (where game_type = 'REG') as points_against
    from scores
    group by team, season
),
"for" as (
    select tgs.team, tgs.season,
        avg(tgs.rush_yds) as rush_yds_avg,
        avg(tgs.pass_yds) as pass_yds_avg,
        sum(tgs.ints_thrown) as turnovers_int,
        sum(tgs.fumbles_lost) as turnovers_fumble,
        sum(tgs.rush_td) as rush_td,
        sum(tgs.pass_td) as pass_td,
        sum(tgs.rec_td) as rec_td,
        sum(tgs.completions) as completions,
        sum(tgs.attempts) as attempts,
        avg(tgs.punts) as punts_avg,
        sum(tgs.punts) as punts_sum,
        sum(tgs.pt_returned) as pt_returned_sum,
        sum(tgs.punt_returns) as punt_returns_sum,
        avg(tgs.kick_return_yards) as kick_return_yards_avg,
        avg(tgs.punt_return_yards) as punt_return_yards_avg,
        avg(tgs.offense_snaps) as offense_snaps_avg,
        avg(tgs.defense_snaps) as defense_snaps_avg,
        sum(tgs.sacks) as sacks,
        sum(tgs.qb_hits) as qb_hits,
        sum(tgs.tfl) as tfl,
        sum(tgs.pass_defended) as pass_defended,
        sum(tgs.def_ints) as def_ints,
        sum(tgs.def_td) as def_td,
        sum(tgs.st_td) as st_td,
        sum(tgs.fg_made) as fg_made
    from team_game_stats tgs
    join games g on g.game_id = tgs.game_id
    where tgs.game_type = 'REG' and g.home_score is not null and g.away_score is not null
    group by tgs.team, tgs.season
),
against as (
    select tgs.opponent_team as team, tgs.season,
        avg(tgs.rush_yds) as rush_yds_allowed_avg,
        avg(tgs.pass_yds) as pass_yds_allowed_avg,
        sum(tgs.ints_thrown) as takeaways_int,
        sum(tgs.fumbles_lost) as takeaways_fumble,
        sum(tgs.rush_td) as rush_td_allowed,
        sum(tgs.pass_td) as pass_td_allowed,
        sum(tgs.rec_td) as rec_td_allowed,
        sum(tgs.completions) as completions_allowed,
        sum(tgs.attempts) as attempts_allowed,
        avg(tgs.punts) as punts_allowed_avg,
        sum(tgs.punts) as punts_allowed_sum,
        avg(tgs.kick_return_yards) as kick_return_yards_allowed_avg,
        avg(tgs.punt_return_yards) as punt_return_yards_allowed_avg,
        avg(tgs.offense_snaps) as offense_snaps_allowed_avg,
        avg(tgs.defense_snaps) as defense_snaps_allowed_avg,
        sum(tgs.sacks) as sacks_allowed,
        sum(tgs.qb_hits) as qb_hits_allowed,
        sum(tgs.tfl) as tfl_allowed,
        sum(tgs.pass_defended) as pass_defended_allowed,
        sum(tgs.def_ints) as def_ints_allowed,
        sum(tgs.def_td) as def_td_allowed,
        sum(tgs.st_td) as st_td_allowed,
        sum(tgs.fg_made) as fg_made_allowed
    from team_game_stats tgs
    join games g on g.game_id = tgs.game_id
    where tgs.game_type = 'REG' and g.home_score is not null and g.away_score is not null
    group by tgs.opponent_team, tgs.season
)
select
    r.team, r.season, t.conference, t.division, r.games_played,
    r.wins, r.losses, r.ties, (r.wins - r.losses) as win_diff,
    r.points_for, r.points_against, (r.points_for - r.points_against) as point_diff,
    f.rush_yds_avg, a.rush_yds_allowed_avg,
    f.pass_yds_avg, a.pass_yds_allowed_avg,
    f.turnovers_int, f.turnovers_fumble, a.takeaways_int, a.takeaways_fumble,
    f.rush_td, a.rush_td_allowed,
    f.pass_td, a.pass_td_allowed,
    f.rec_td, a.rec_td_allowed,
    f.punts_avg, a.punts_allowed_avg,
    round(100.0 * f.pt_returned_sum / nullif(f.punts_sum, 0), 1) as punt_return_pct_for,
    round(100.0 * f.punt_returns_sum / nullif(a.punts_allowed_sum, 0), 1) as punt_return_pct_against,
    f.kick_return_yards_avg, a.kick_return_yards_allowed_avg,
    f.punt_return_yards_avg, a.punt_return_yards_allowed_avg,
    f.offense_snaps_avg, a.offense_snaps_allowed_avg,
    f.defense_snaps_avg, a.defense_snaps_allowed_avg,
    f.sacks, a.sacks_allowed,
    f.qb_hits, a.qb_hits_allowed,
    f.tfl, a.tfl_allowed,
    f.pass_defended, a.pass_defended_allowed,
    f.def_ints, a.def_ints_allowed,
    round(100.0 * f.completions / nullif(f.attempts, 0), 1) as comp_pct_for,
    round(100.0 * a.completions_allowed / nullif(a.attempts_allowed, 0), 1) as comp_pct_against,
    f.def_td, a.def_td_allowed,
    f.st_td, a.st_td_allowed,
    f.fg_made, a.fg_made_allowed
from record r
join "for" f on f.team = r.team and f.season = r.season
join against a on a.team = r.team and a.season = r.season
join teams t on t.team_abbr = r.team;

create unique index team_season_stats_pk on team_season_stats (team, season);
grant select on team_season_stats to anon, authenticated;

-- Unchanged from 0007_wr_target_diff.sql -- just needs recreating since it
-- depends on team_season_stats, which had to be dropped above.
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
