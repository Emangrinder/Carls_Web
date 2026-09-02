-- Add conference/division to team_season_stats so the frontend can group
-- by conference without a second round trip or a client-side join --
-- everything else about the view is unchanged from 0002.

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
    r.team, r.season, t.conference, t.division, r.games_played,
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
join against a on a.team = r.team and a.season = r.season
join teams t on t.team_abbr = r.team;

create unique index team_season_stats_pk on team_season_stats (team, season);
grant select on team_season_stats to anon, authenticated;
