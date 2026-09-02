-- Carls_Web — derived data: materialized views computed from the raw tables
-- in 0001. Nothing here is ever written directly by the ETL; it all comes
-- from `REFRESH MATERIALIZED VIEW ... ` after raw tables are updated.
--
-- Materialized views don't support ROW LEVEL SECURITY (Postgres only applies
-- RLS to plain tables) — since everything here is public read-only anyway,
-- a plain GRANT SELECT to anon/authenticated is the equivalent.

-- One row per (team, game): this team's own box-score output for that game.
-- Both teams in a game get a row, each keyed off their own perspective, with
-- opponent_team recorded so a team's AGAINST numbers can be derived later by
-- grouping on opponent_team instead of team (see team_season_stats below) —
-- no need to duplicate every column as a separate "_allowed" version here.
create materialized view team_game_stats as
with team_games as (
    select game_id, season, week, game_type, home_team as team, away_team as opponent_team from games
    union all
    select game_id, season, week, game_type, away_team as team, home_team as opponent_team from games
),
offense as (
    select game_id, team,
        sum(coalesce(passing_yards, 0)) as pass_yds,
        sum(coalesce(rushing_yards, 0)) as rush_yds,
        sum(coalesce(passing_tds, 0)) as pass_td,
        sum(coalesce(rushing_tds, 0)) as rush_td,
        sum(coalesce(passing_interceptions, 0)) as ints_thrown,
        sum(coalesce(sack_fumbles_lost, 0)) + sum(coalesce(rushing_fumbles_lost, 0))
            + sum(coalesce(receiving_fumbles_lost, 0)) as fumbles_lost
    from player_offense_stats
    group by game_id, team
),
defense as (
    select game_id, team,
        sum(coalesce(def_sacks, 0)) as sacks,
        sum(coalesce(def_interceptions, 0)) as def_ints
    from player_defense_stats
    group by game_id, team
),
special as (
    select game_id, team,
        sum(coalesce(pt_att, 0)) as punts,
        sum(coalesce(pt_yards, 0)) as punt_yards,
        sum(coalesce(kickoff_return_yards, 0)) as kick_return_yards,
        sum(coalesce(punt_return_yards, 0)) as punt_return_yards
    from player_special_teams_stats
    group by game_id, team
),
snaps as (
    select game_id, team,
        sum(coalesce(offense_snaps, 0)) as offense_snaps,
        sum(coalesce(defense_snaps, 0)) as defense_snaps
    from player_snap_counts
    group by game_id, team
)
select
    tg.game_id, tg.team, tg.opponent_team, tg.season, tg.week, tg.game_type,
    coalesce(o.pass_yds, 0) as pass_yds,
    coalesce(o.rush_yds, 0) as rush_yds,
    coalesce(o.pass_td, 0) as pass_td,
    coalesce(o.rush_td, 0) as rush_td,
    coalesce(o.ints_thrown, 0) as ints_thrown,
    coalesce(o.fumbles_lost, 0) as fumbles_lost,
    coalesce(d.sacks, 0) as sacks,
    coalesce(d.def_ints, 0) as def_ints,
    coalesce(s.punts, 0) as punts,
    coalesce(s.punt_yards, 0) as punt_yards,
    coalesce(s.kick_return_yards, 0) as kick_return_yards,
    coalesce(s.punt_return_yards, 0) as punt_return_yards,
    coalesce(sn.offense_snaps, 0) as offense_snaps,
    coalesce(sn.defense_snaps, 0) as defense_snaps
from team_games tg
left join offense o on o.game_id = tg.game_id and o.team = tg.team
left join defense d on d.game_id = tg.game_id and d.team = tg.team
left join special s on s.game_id = tg.game_id and s.team = tg.team
left join snaps sn on sn.game_id = tg.game_id and sn.team = tg.team;

create unique index team_game_stats_pk on team_game_stats (game_id, team);
grant select on team_game_stats to anon, authenticated;

-- One row per (team, season): the ranking-table / team-page numbers.
-- FOR = aggregated from this team's own team_game_stats rows.
-- AGAINST = aggregated from the SAME rows grouped by opponent_team instead —
-- "what this team's opponents did in the same games" is exactly "what this
-- team allowed", so no separate allowed-stat pipeline is needed.
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
    select team, season,
        avg(rush_yds) as rush_yds_avg,
        avg(pass_yds) as pass_yds_avg,
        sum(ints_thrown) as turnovers_int,
        sum(fumbles_lost) as turnovers_fumble,
        sum(rush_td) as rush_td,
        sum(pass_td) as pass_td,
        sum(punts) as punts,
        avg(kick_return_yards) as kick_return_yards_avg,
        avg(punt_return_yards) as punt_return_yards_avg,
        avg(offense_snaps) as offense_snaps_avg,
        avg(defense_snaps) as defense_snaps_avg,
        sum(sacks) as sacks,
        sum(def_ints) as def_ints
    from team_game_stats
    where game_type = 'REG'
    group by team, season
),
against as (
    select opponent_team as team, season,
        avg(rush_yds) as rush_yds_allowed_avg,
        avg(pass_yds) as pass_yds_allowed_avg,
        sum(ints_thrown) as takeaways_int,
        sum(fumbles_lost) as takeaways_fumble,
        sum(rush_td) as rush_td_allowed,
        sum(pass_td) as pass_td_allowed,
        sum(punts) as punts_allowed,
        avg(kick_return_yards) as kick_return_yards_allowed_avg,
        avg(punt_return_yards) as punt_return_yards_allowed_avg,
        avg(offense_snaps) as offense_snaps_allowed_avg,
        avg(defense_snaps) as defense_snaps_allowed_avg,
        sum(sacks) as sacks_allowed,
        sum(def_ints) as def_ints_allowed
    from team_game_stats
    where game_type = 'REG'
    group by opponent_team, season
)
select
    r.team, r.season, r.games_played,
    r.wins, r.losses, r.ties, (r.wins - r.losses) as win_diff,
    r.points_for, r.points_against, (r.points_for - r.points_against) as point_diff,
    f.rush_yds_avg, a.rush_yds_allowed_avg,
    f.pass_yds_avg, a.pass_yds_allowed_avg,
    f.turnovers_int, f.turnovers_fumble, a.takeaways_int, a.takeaways_fumble,
    f.rush_td, a.rush_td_allowed,
    f.pass_td, a.pass_td_allowed,
    f.punts, a.punts_allowed,
    f.kick_return_yards_avg, a.kick_return_yards_allowed_avg,
    f.punt_return_yards_avg, a.punt_return_yards_allowed_avg,
    f.offense_snaps_avg, a.offense_snaps_allowed_avg,
    f.defense_snaps_avg, a.defense_snaps_allowed_avg,
    f.sacks, a.sacks_allowed,
    f.def_ints, a.def_ints_allowed
from record r
join "for" f on f.team = r.team and f.season = r.season
join against a on a.team = r.team and a.season = r.season;

create unique index team_season_stats_pk on team_season_stats (team, season);
grant select on team_season_stats to anon, authenticated;

-- Player season rollups. Grouped by (player_id, team, season) rather than
-- just (player_id, season) so a mid-season trade shows as separate lines per
-- team, matching how stat sites usually display a traded player's season.
-- Counting/yardage/EPA columns are summed (season totals); the handful of
-- rate stats (cpoe, pacr, racr, share metrics) are averaged, since summing
-- a per-game rate across games isn't meaningful.

create materialized view player_season_offense_stats as
select
    player_id, team, g.season,
    count(*) as games,
    sum(completions) as completions,
    sum(attempts) as attempts,
    sum(passing_yards) as passing_yards,
    sum(passing_tds) as passing_tds,
    sum(passing_interceptions) as passing_interceptions,
    sum(sacks_suffered) as sacks_suffered,
    sum(sack_yards_lost) as sack_yards_lost,
    sum(sack_fumbles) as sack_fumbles,
    sum(sack_fumbles_lost) as sack_fumbles_lost,
    sum(passing_air_yards) as passing_air_yards,
    sum(passing_yards_after_catch) as passing_yards_after_catch,
    sum(passing_first_downs) as passing_first_downs,
    sum(passing_epa) as passing_epa,
    avg(passing_cpoe) as passing_cpoe,
    sum(passing_2pt_conversions) as passing_2pt_conversions,
    avg(pacr) as pacr,
    sum(carries) as carries,
    sum(rushing_yards) as rushing_yards,
    sum(rushing_tds) as rushing_tds,
    sum(rushing_fumbles) as rushing_fumbles,
    sum(rushing_fumbles_lost) as rushing_fumbles_lost,
    sum(rushing_first_downs) as rushing_first_downs,
    sum(rushing_epa) as rushing_epa,
    sum(rushing_2pt_conversions) as rushing_2pt_conversions,
    sum(receptions) as receptions,
    sum(targets) as targets,
    sum(receiving_yards) as receiving_yards,
    sum(receiving_tds) as receiving_tds,
    sum(receiving_fumbles) as receiving_fumbles,
    sum(receiving_fumbles_lost) as receiving_fumbles_lost,
    sum(receiving_air_yards) as receiving_air_yards,
    sum(receiving_yards_after_catch) as receiving_yards_after_catch,
    sum(receiving_first_downs) as receiving_first_downs,
    sum(receiving_epa) as receiving_epa,
    sum(receiving_2pt_conversions) as receiving_2pt_conversions,
    avg(racr) as racr,
    avg(target_share) as target_share,
    avg(air_yards_share) as air_yards_share,
    avg(wopr) as wopr,
    sum(fantasy_points) as fantasy_points,
    sum(fantasy_points_ppr) as fantasy_points_ppr,
    sum(passing_20) as passing_20,
    sum(passing_40) as passing_40,
    sum(rushing_20) as rushing_20,
    sum(rushing_40) as rushing_40,
    sum(receiving_20) as receiving_20,
    sum(receiving_40) as receiving_40,
    sum(rushing_yards_after_contact) as rushing_yards_after_contact,
    sum(penalties) as penalties,
    sum(penalty_yards) as penalty_yards
from player_offense_stats pos
join games g on g.game_id = pos.game_id
group by player_id, team, g.season;

grant select on player_season_offense_stats to anon, authenticated;

create materialized view player_season_defense_stats as
select
    player_id, team, g.season,
    count(*) as games,
    sum(def_tackles_solo) as def_tackles_solo,
    sum(def_tackles_with_assist) as def_tackles_with_assist,
    sum(def_tackle_assists) as def_tackle_assists,
    sum(def_tackles_for_loss) as def_tackles_for_loss,
    sum(def_tackles_for_loss_yards) as def_tackles_for_loss_yards,
    sum(def_fumbles_forced) as def_fumbles_forced,
    sum(def_sacks) as def_sacks,
    sum(def_sack_yards) as def_sack_yards,
    sum(def_qb_hits) as def_qb_hits,
    sum(def_interceptions) as def_interceptions,
    sum(def_interception_yards) as def_interception_yards,
    sum(def_pass_defended) as def_pass_defended,
    sum(def_tds) as def_tds,
    sum(def_fumbles) as def_fumbles,
    sum(def_safeties) as def_safeties,
    sum(fumble_recovery_own) as fumble_recovery_own,
    sum(fumble_recovery_yards_own) as fumble_recovery_yards_own,
    sum(fumble_recovery_opp) as fumble_recovery_opp,
    sum(fumble_recovery_yards_opp) as fumble_recovery_yards_opp,
    sum(fumble_recovery_tds) as fumble_recovery_tds,
    sum(penalties) as penalties,
    sum(penalty_yards) as penalty_yards
from player_defense_stats pds
join games g on g.game_id = pds.game_id
group by player_id, team, g.season;

grant select on player_season_defense_stats to anon, authenticated;

create materialized view player_season_special_teams_stats as
select
    player_id, team, g.season,
    count(*) as games,
    sum(fg_made) as fg_made,
    sum(fg_att) as fg_att,
    sum(fg_missed) as fg_missed,
    sum(fg_blocked) as fg_blocked,
    max(fg_long) as fg_long,
    round(sum(fg_made)::numeric / nullif(sum(fg_att), 0), 3) as fg_pct,
    sum(fg_made_0_19) as fg_made_0_19,
    sum(fg_made_20_29) as fg_made_20_29,
    sum(fg_made_30_39) as fg_made_30_39,
    sum(fg_made_40_49) as fg_made_40_49,
    sum(fg_made_50_59) as fg_made_50_59,
    sum(fg_made_60_) as fg_made_60_,
    sum(fg_made_70_) as fg_made_70_,
    sum(pat_made) as pat_made,
    sum(pat_att) as pat_att,
    sum(pat_missed) as pat_missed,
    sum(pat_blocked) as pat_blocked,
    round(sum(pat_made)::numeric / nullif(sum(pat_att), 0), 3) as pat_pct,
    sum(gwfg_made) as gwfg_made,
    sum(gwfg_att) as gwfg_att,
    sum(pt_att) as pt_att,
    sum(pt_blocked) as pt_blocked,
    max(pt_long) as pt_long,
    sum(pt_yards) as pt_yards,
    sum(pt_net_yards) as pt_net_yards,
    sum(pt_inside_20) as pt_inside_20,
    sum(pt_touchback) as pt_touchback,
    sum(pt_returned) as pt_returned,
    sum(punt_returns) as punt_returns,
    sum(punt_return_yards) as punt_return_yards,
    sum(kickoff_returns) as kickoff_returns,
    sum(kickoff_return_yards) as kickoff_return_yards,
    sum(special_teams_tds) as special_teams_tds,
    sum(penalties) as penalties,
    sum(penalty_yards) as penalty_yards
from player_special_teams_stats psts
join games g on g.game_id = psts.game_id
group by player_id, team, g.season;

grant select on player_season_special_teams_stats to anon, authenticated;

-- Player season snap-count totals, matching the same (player_id, team,
-- season) grain as the stat rollups above.
create materialized view player_season_snap_counts as
select
    player_id, team, g.season,
    count(*) as games,
    sum(offense_snaps) as offense_snaps,
    sum(defense_snaps) as defense_snaps,
    sum(st_snaps) as st_snaps
from player_snap_counts psc
join games g on g.game_id = psc.game_id
group by player_id, team, g.season;

grant select on player_season_snap_counts to anon, authenticated;
