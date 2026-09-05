-- Splits per-game defense fantasy points into Pressure/Coverage/Turnover
-- (so the Fantasy Scores page can rank each toggle by its own points, not
-- one lumped Defense total), and adds team-level Head Coach/Offensive
-- Coordinator/Defensive Coordinator scoring (build_coach_fantasy_scores.py).
-- See that script's docstring for the couple of sub-bonuses it can't
-- compute from our current stat aggregates.

alter table player_game_fantasy_points
    add column pressure_points real,
    add column coverage_points real,
    add column turnover_points real;

drop materialized view if exists player_season_fantasy_points;

create materialized view player_season_fantasy_points as
select
    fp.player_id, g.season,
    count(*) as games,
    round(sum(fp.passing_points)::numeric, 1) as passing_points,
    round(sum(fp.rushing_points)::numeric, 1) as rushing_points,
    round(sum(fp.receiving_points)::numeric, 1) as receiving_points,
    round(sum(fp.blocking_bonus_points)::numeric, 1) as blocking_bonus_points,
    round(sum(fp.fumbles_fouls_points)::numeric, 1) as fumbles_fouls_points,
    round(sum(fp.defense_points)::numeric, 1) as defense_points,
    round(sum(fp.pressure_points)::numeric, 1) as pressure_points,
    round(sum(fp.coverage_points)::numeric, 1) as coverage_points,
    round(sum(fp.turnover_points)::numeric, 1) as turnover_points,
    round(sum(fp.kicking_points)::numeric, 1) as kicking_points,
    round(sum(fp.punting_points)::numeric, 1) as punting_points,
    round(sum(fp.returning_points)::numeric, 1) as returning_points,
    round(sum(fp.total_points)::numeric, 1) as total_points,
    round((sum(fp.total_points) / count(*))::numeric, 1) as avg_points
from player_game_fantasy_points fp
join games g on g.game_id = fp.game_id
group by fp.player_id, g.season;

create unique index player_season_fantasy_points_pk on player_season_fantasy_points (player_id, season);
grant select on player_season_fantasy_points to anon, authenticated;

create table team_game_fantasy_points (
    team                  text references teams(team_abbr),
    game_id               text references games(game_id),
    coach_head_points     real,
    coach_offense_points  real,
    coach_defense_points  real,
    primary key (team, game_id)
);

alter table team_game_fantasy_points enable row level security;
create policy "Public read access" on team_game_fantasy_points for select to anon, authenticated using (true);
grant select on team_game_fantasy_points to anon, authenticated;

create materialized view team_season_fantasy_points as
select
    tp.team, g.season,
    count(*) as games,
    round(sum(tp.coach_head_points)::numeric, 1) as coach_head_points,
    round(sum(tp.coach_offense_points)::numeric, 1) as coach_offense_points,
    round(sum(tp.coach_defense_points)::numeric, 1) as coach_defense_points,
    round((sum(tp.coach_head_points) / count(*))::numeric, 1) as coach_head_avg,
    round((sum(tp.coach_offense_points) / count(*))::numeric, 1) as coach_offense_avg,
    round((sum(tp.coach_defense_points) / count(*))::numeric, 1) as coach_defense_avg
from team_game_fantasy_points tp
join games g on g.game_id = tp.game_id
group by tp.team, g.season;

create unique index team_season_fantasy_points_pk on team_season_fantasy_points (team, season);
grant select on team_season_fantasy_points to anon, authenticated;
