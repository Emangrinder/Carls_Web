-- Adds broken tackles (offense, rushing + receiving combined) and missed
-- tackles + PFR's own combined-tackle count (defense) -- both from the
-- pfr_advstats release, now loaded into player_offense_stats/
-- player_defense_stats by build_db.py. Needs team_game_stats extended too
-- (not just team_season_stats, unlike 0016/0018), since these are new raw
-- per-game aggregates, not something derivable from existing columns.
--
-- Powers the NFL Matchup page's broken-tackle vulnerability index:
-- opponent's Broken Tackles/G x this team's own missed-tackle rate
-- (missed_tackles_avg / tackles_avg). def_tackles_combined is kept
-- separate from the existing def_tackles_solo/with_assist (a different
-- source, nflverse's own play-by-play-derived counts) so that rate's
-- numerator and denominator both come from PFR's counting method.

alter table player_offense_stats
    add column broken_tackles integer;

alter table player_defense_stats
    add column def_missed_tackles integer,
    add column def_tackles_combined integer;

drop materialized view if exists team_share_stats;
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
        sum(coalesce(receiving_tds, 0)) as rec_td,
        sum(coalesce(completions, 0)) as completions,
        sum(coalesce(attempts, 0)) as attempts,
        sum(coalesce(passing_interceptions, 0)) as ints_thrown,
        sum(coalesce(sack_fumbles_lost, 0)) + sum(coalesce(rushing_fumbles_lost, 0))
            + sum(coalesce(receiving_fumbles_lost, 0)) as fumbles_lost,
        sum(coalesce(broken_tackles, 0)) as broken_tackles
    from player_offense_stats
    group by game_id, team
),
defense as (
    select game_id, team,
        sum(coalesce(def_sacks, 0)) as sacks,
        sum(coalesce(def_qb_hits, 0)) as qb_hits,
        sum(coalesce(def_tackles_for_loss, 0)) as tfl,
        sum(coalesce(def_pass_defended, 0)) as pass_defended,
        sum(coalesce(def_interceptions, 0)) as def_ints,
        sum(coalesce(def_tds, 0)) as def_td,
        sum(coalesce(def_missed_tackles, 0)) as missed_tackles,
        sum(coalesce(def_tackles_combined, 0)) as tackles_combined
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
        sum(coalesce(punt_return_yards, 0)) as punt_return_yards,
        sum(coalesce(special_teams_tds, 0)) as st_td,
        sum(coalesce(fg_made, 0)) as fg_made
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
    coalesce(o.rec_td, 0) as rec_td,
    coalesce(o.completions, 0) as completions,
    coalesce(o.attempts, 0) as attempts,
    coalesce(o.ints_thrown, 0) as ints_thrown,
    coalesce(o.fumbles_lost, 0) as fumbles_lost,
    coalesce(o.broken_tackles, 0) as broken_tackles,
    coalesce(d.sacks, 0) as sacks,
    coalesce(d.qb_hits, 0) as qb_hits,
    coalesce(d.tfl, 0) as tfl,
    coalesce(d.pass_defended, 0) as pass_defended,
    coalesce(d.def_ints, 0) as def_ints,
    coalesce(d.def_td, 0) as def_td,
    coalesce(d.missed_tackles, 0) as missed_tackles,
    coalesce(d.tackles_combined, 0) as tackles_combined,
    coalesce(s.punts, 0) as punts,
    coalesce(s.punt_yards, 0) as punt_yards,
    coalesce(s.pt_returned, 0) as pt_returned,
    coalesce(s.punt_returns, 0) as punt_returns,
    coalesce(s.kick_return_yards, 0) as kick_return_yards,
    coalesce(s.punt_return_yards, 0) as punt_return_yards,
    coalesce(s.st_td, 0) as st_td,
    coalesce(s.fg_made, 0) as fg_made,
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
        avg(tgs.broken_tackles) as broken_tackles_avg,
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
        sum(tgs.fg_made) as fg_made,
        avg(tgs.missed_tackles) as missed_tackles_avg,
        avg(tgs.tackles_combined) as tackles_avg
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
        avg(tgs.broken_tackles) as broken_tackles_allowed_avg,
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
        sum(tgs.fg_made) as fg_made_allowed,
        avg(tgs.missed_tackles) as missed_tackles_allowed_avg,
        avg(tgs.tackles_combined) as tackles_allowed_avg
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
    f.broken_tackles_avg, a.broken_tackles_allowed_avg,
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
    f.fg_made, a.fg_made_allowed,
    f.missed_tackles_avg, a.missed_tackles_allowed_avg,
    f.tackles_avg, a.tackles_allowed_avg
from record r
join "for" f on f.team = r.team and f.season = r.season
join against a on a.team = r.team and a.season = r.season
join teams t on t.team_abbr = r.team;

create unique index team_season_stats_pk on team_season_stats (team, season);
grant select on team_season_stats to anon, authenticated;

-- Unchanged from 0018_revert_pass_attempts_and_pd_rate.sql -- just needs
-- recreating since it depends on team_season_stats, which had to be
-- dropped above.
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
