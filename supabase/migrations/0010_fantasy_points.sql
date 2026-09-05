-- Per-game fantasy points, computed by etl/data/nflverse/build_fantasy_scores.py
-- from player_offense_stats/player_defense_stats/player_special_teams_stats,
-- applying the Fantasy Rules scoring formulas (app/src/fantasyRulesData.js)
-- universally -- whoever recorded a stat scores its points, not just the
-- position the rule group was nominally drawn up around. See that script's
-- own docstring for which specific sub-bonuses aren't computable from these
-- per-game aggregates (mainly TD-length tiers and blocked-kick credit).

create table player_game_fantasy_points (
    player_id             text references players(player_id),
    game_id               text references games(game_id),
    team                  text,
    passing_points        real,
    rushing_points        real,
    receiving_points      real,
    blocking_bonus_points real,
    fumbles_fouls_points  real,
    defense_points        real,
    kicking_points        real,
    punting_points        real,
    returning_points      real,
    total_points          real not null,
    primary key (player_id, game_id)
);

alter table player_game_fantasy_points enable row level security;
create policy "Public read access" on player_game_fantasy_points for select to anon, authenticated using (true);
grant select on player_game_fantasy_points to anon, authenticated;

-- Season totals/averages per category, for the Fantasy Scores page and the
-- player-page fantasy-points section.
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
