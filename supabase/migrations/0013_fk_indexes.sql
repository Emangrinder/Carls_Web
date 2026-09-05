-- Covering indexes for foreign keys Supabase's own advisor flagged as
-- unindexed. Most of PlayerPage.jsx's queries filter by player_id (or
-- game_id, for the team-level tables) on tables whose primary key doesn't
-- lead with that column, so every one of these was a sequential scan --
-- fine for a single request in isolation, but exactly the kind of thing
-- that compounds into timeouts under real concurrent traffic.

create index if not exists player_offense_stats_game_id_idx on player_offense_stats (game_id);
create index if not exists player_defense_stats_game_id_idx on player_defense_stats (game_id);
create index if not exists player_special_teams_stats_game_id_idx on player_special_teams_stats (game_id);
create index if not exists player_snap_counts_game_id_idx on player_snap_counts (game_id);
create index if not exists player_game_fantasy_points_game_id_idx on player_game_fantasy_points (game_id);
create index if not exists team_game_fantasy_points_game_id_idx on team_game_fantasy_points (game_id);

create index if not exists college_rosters_player_id_idx on college_rosters (player_id);
create index if not exists college_player_season_stats_player_id_idx on college_player_season_stats (player_id);
create index if not exists depth_chart_ranks_player_id_idx on depth_chart_ranks (player_id);
create index if not exists depth_chart_history_player_id_idx on depth_chart_history (player_id);
create index if not exists injuries_player_id_idx on injuries (player_id);
create index if not exists trades_player_id_idx on trades (player_id);

create index if not exists games_home_team_idx on games (home_team);
create index if not exists games_away_team_idx on games (away_team);
