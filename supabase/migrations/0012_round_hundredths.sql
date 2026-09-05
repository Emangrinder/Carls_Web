-- Rounds the season-aggregate fantasy-points views to hundredths (was
-- tenths) to match the per-game tables, which build_fantasy_scores.py /
-- build_coach_fantasy_scores.py now also round to 2 decimals (was 3) --
-- avoids storing/displaying long floating-point tails.

drop materialized view if exists player_season_fantasy_points;

create materialized view player_season_fantasy_points as
select
    fp.player_id, g.season,
    count(*) as games,
    round(sum(fp.passing_points)::numeric, 2) as passing_points,
    round(sum(fp.rushing_points)::numeric, 2) as rushing_points,
    round(sum(fp.receiving_points)::numeric, 2) as receiving_points,
    round(sum(fp.blocking_bonus_points)::numeric, 2) as blocking_bonus_points,
    round(sum(fp.fumbles_fouls_points)::numeric, 2) as fumbles_fouls_points,
    round(sum(fp.defense_points)::numeric, 2) as defense_points,
    round(sum(fp.pressure_points)::numeric, 2) as pressure_points,
    round(sum(fp.coverage_points)::numeric, 2) as coverage_points,
    round(sum(fp.turnover_points)::numeric, 2) as turnover_points,
    round(sum(fp.kicking_points)::numeric, 2) as kicking_points,
    round(sum(fp.punting_points)::numeric, 2) as punting_points,
    round(sum(fp.returning_points)::numeric, 2) as returning_points,
    round(sum(fp.total_points)::numeric, 2) as total_points,
    round((sum(fp.total_points) / count(*))::numeric, 2) as avg_points
from player_game_fantasy_points fp
join games g on g.game_id = fp.game_id
group by fp.player_id, g.season;

create unique index player_season_fantasy_points_pk on player_season_fantasy_points (player_id, season);
grant select on player_season_fantasy_points to anon, authenticated;

drop materialized view if exists team_season_fantasy_points;

create materialized view team_season_fantasy_points as
select
    tp.team, g.season,
    count(*) as games,
    round(sum(tp.coach_head_points)::numeric, 2) as coach_head_points,
    round(sum(tp.coach_offense_points)::numeric, 2) as coach_offense_points,
    round(sum(tp.coach_defense_points)::numeric, 2) as coach_defense_points,
    round((sum(tp.coach_head_points) / count(*))::numeric, 2) as coach_head_avg,
    round((sum(tp.coach_offense_points) / count(*))::numeric, 2) as coach_offense_avg,
    round((sum(tp.coach_defense_points) / count(*))::numeric, 2) as coach_defense_avg
from team_game_fantasy_points tp
join games g on g.game_id = tp.game_id
group by tp.team, g.season;

create unique index team_season_fantasy_points_pk on team_season_fantasy_points (team, season);
grant select on team_season_fantasy_points to anon, authenticated;
