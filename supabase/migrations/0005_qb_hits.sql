-- Adds QB hits alongside the sacks this team's defense already tracks --
-- same drop+recreate pattern as prior migrations since these are
-- materialized views, not tables.

drop materialized view if exists team_season_stats;
drop materialized view if exists team_game_stats;

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
        sum(coalesce(def_qb_hits, 0)) as qb_hits,
        sum(coalesce(def_interceptions, 0)) as def_ints
    from player_defense_stats
    group by game_id, team
),
special as (
    select game_id, team,
        sum(coalesce(pt_att, 0)) as punts,
        sum(coalesce(pt_yards, 0)) as punt_yards,
        sum(coalesce(pt_returned, 0)) as pt_returned,
        sum(coalesce(punt_returns, 0)) as punt_returns,
        sum(coalesce(kickoff_return_yards, 0)) as kick_return_yards,
        sum(coalesce(punt_return_yards, 0)) as punt_return_yards
    from player_special_teams_stats
    group by game_id, team
),
snaps as (
    select game_id, team,
        max(coalesce(offense_snaps, 0)) as offense_snaps,
        max(coalesce(defense_snaps, 0)) as defense_snaps
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
    coalesce(d.qb_hits, 0) as qb_hits,
    coalesce(d.def_ints, 0) as def_ints,
    coalesce(s.punts, 0) as punts,
    coalesce(s.punt_yards, 0) as punt_yards,
    coalesce(s.pt_returned, 0) as pt_returned,
    coalesce(s.punt_returns, 0) as punt_returns,
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
        avg(punts) as punts_avg,
        sum(punts) as punts_sum,
        sum(pt_returned) as pt_returned_sum,
        sum(punt_returns) as punt_returns_sum,
        avg(kick_return_yards) as kick_return_yards_avg,
        avg(punt_return_yards) as punt_return_yards_avg,
        avg(offense_snaps) as offense_snaps_avg,
        avg(defense_snaps) as defense_snaps_avg,
        sum(sacks) as sacks,
        sum(qb_hits) as qb_hits,
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
        avg(punts) as punts_allowed_avg,
        sum(punts) as punts_allowed_sum,
        avg(kick_return_yards) as kick_return_yards_allowed_avg,
        avg(punt_return_yards) as punt_return_yards_allowed_avg,
        avg(offense_snaps) as offense_snaps_allowed_avg,
        avg(defense_snaps) as defense_snaps_allowed_avg,
        sum(sacks) as sacks_allowed,
        sum(qb_hits) as qb_hits_allowed,
        sum(def_ints) as def_ints_allowed
    from team_game_stats
    where game_type = 'REG'
    group by opponent_team, season
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
    f.punts_avg, a.punts_allowed_avg,
    round(100.0 * f.pt_returned_sum / nullif(f.punts_sum, 0), 1) as punt_return_pct_for,
    round(100.0 * f.punt_returns_sum / nullif(a.punts_allowed_sum, 0), 1) as punt_return_pct_against,
    f.kick_return_yards_avg, a.kick_return_yards_allowed_avg,
    f.punt_return_yards_avg, a.punt_return_yards_allowed_avg,
    f.offense_snaps_avg, a.offense_snaps_allowed_avg,
    f.defense_snaps_avg, a.defense_snaps_allowed_avg,
    f.sacks, a.sacks_allowed,
    f.qb_hits, a.qb_hits_allowed,
    f.def_ints, a.def_ints_allowed
from record r
join "for" f on f.team = r.team and f.season = r.season
join against a on a.team = r.team and a.season = r.season
join teams t on t.team_abbr = r.team;

create unique index team_season_stats_pk on team_season_stats (team, season);
grant select on team_season_stats to anon, authenticated;
