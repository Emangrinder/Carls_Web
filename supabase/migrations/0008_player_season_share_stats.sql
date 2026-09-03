-- Per-player share-of-team percentages, for the TeamPage depth chart hover
-- card (RB "team carry %", WR/TE "team target %"). Window functions instead
-- of a group-by so every player keeps their own row alongside the team
-- totals used to divide it -- team_share_stats already has the team-wide
-- aggregates, but this is the per-player counterpart.

create materialized view player_season_share_stats as
select
    pos.player_id, pos.team, pos.season,
    round(
        100.0 * pos.carries / nullif(
            sum(pos.carries) filter (where pl.position = 'RB') over (partition by pos.team, pos.season),
            0
        ), 1
    ) as team_rb_carry_pct,
    round(
        100.0 * pos.targets / nullif(sum(pos.targets) over (partition by pos.team, pos.season), 0),
        1
    ) as team_target_pct
from player_season_offense_stats pos
join players pl on pl.player_id = pos.player_id;

create unique index player_season_share_stats_pk on player_season_share_stats (player_id, team, season);
grant select on player_season_share_stats to anon, authenticated;
