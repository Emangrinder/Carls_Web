-- Carls_Web — core schema (raw, per-game data from nflverse-data / cfbfastR-data).
-- Ported from the Another_Fantasy SQLite prototype. Coaches intentionally
-- deferred to a later migration until the player/roster pipeline is solid.
--
-- Every table here is RLS-enabled with a single public-read policy: the anon
-- and authenticated roles can SELECT, nobody can write except the service_role
-- key (which bypasses RLS entirely), used only by the ETL pipeline.

create table teams (
    team_abbr   text primary key,
    team_name   text,
    team_nick   text,
    conference  text,
    division    text
);

create table players (
    player_id      text primary key,   -- gsis_id
    display_name   text,
    first_name     text,
    last_name      text,
    position       text,
    position_group text,
    height         integer,
    weight         integer,
    college_name   text,
    birth_date     date,
    rookie_season  integer,
    jersey_number  integer,
    pfr_id         text,               -- crosswalk key for snap_counts (PFR ids)
    espn_id        text,               -- crosswalk key for ESPN injury reports
    headshot_url   text                -- Supabase Storage public URL, populated by asset upload step
);

create table games (
    game_id      text primary key,
    season       integer not null,
    week         integer not null,
    game_type    text not null,
    gameday      date,
    weekday      text,
    gametime     text,
    home_team    text references teams(team_abbr),
    away_team    text references teams(team_abbr),
    home_score   integer,
    away_score   integer,
    roof         text,
    surface      text,
    temp         integer,
    wind         integer,
    spread_line  real,
    total_line   real,
    referee      text,
    stadium      text
);
create index games_season_week_idx on games(season, week);

create table player_snap_counts (
    player_id     text references players(player_id),
    game_id       text references games(game_id),
    team          text,
    position      text,
    offense_snaps integer,
    offense_pct   real,
    defense_snaps integer,
    defense_pct   real,
    st_snaps      integer,
    st_pct        real,
    primary key (player_id, game_id)
);

-- Stat layer: a player can have rows in any/all three of these for the same
-- game (e.g. a WR who also returns punts).

create table player_offense_stats (
    player_id                  text references players(player_id),
    game_id                    text references games(game_id),
    team                       text,
    opponent_team              text,
    completions                integer,
    attempts                   integer,
    passing_yards              integer,
    passing_tds                integer,
    passing_interceptions      integer,
    sacks_suffered             integer,
    sack_yards_lost            integer,
    sack_fumbles               integer,
    sack_fumbles_lost          integer,
    passing_air_yards          integer,
    passing_yards_after_catch  integer,
    passing_first_downs        integer,
    passing_epa                real,
    passing_cpoe                real,
    passing_2pt_conversions    integer,
    pacr                        real,
    carries                    integer,
    rushing_yards              integer,
    rushing_tds                integer,
    rushing_fumbles            integer,
    rushing_fumbles_lost       integer,
    rushing_first_downs        integer,
    rushing_epa                 real,
    rushing_2pt_conversions    integer,
    receptions                 integer,
    targets                    integer,
    receiving_yards            integer,
    receiving_tds              integer,
    receiving_fumbles          integer,
    receiving_fumbles_lost     integer,
    receiving_air_yards        integer,
    receiving_yards_after_catch integer,
    receiving_first_downs      integer,
    receiving_epa               real,
    receiving_2pt_conversions  integer,
    racr                        real,
    target_share                real,
    air_yards_share              real,
    wopr                          real,
    fantasy_points               real,
    fantasy_points_ppr           real,
    passing_20                 integer,  -- completions of 20+ air yards
    passing_40                 integer,  -- completions of 40+ air yards
    rushing_20                 integer,  -- carries of 20+ yards
    rushing_40                 integer,  -- carries of 40+ yards
    receiving_20               integer,  -- receptions of 20+ yards
    receiving_40               integer,  -- receptions of 40+ yards
    rushing_yards_after_contact real,    -- PFR advanced, 2018+
    penalties                  integer,
    penalty_yards              integer,
    primary key (player_id, game_id)
);

create table player_defense_stats (
    player_id                     text references players(player_id),
    game_id                       text references games(game_id),
    team                          text,
    opponent_team                 text,
    def_tackles_solo              integer,
    def_tackles_with_assist       integer,
    def_tackle_assists            integer,
    def_tackles_for_loss          integer,
    def_tackles_for_loss_yards    real,
    def_fumbles_forced            integer,
    def_sacks                     real,
    def_sack_yards                real,
    def_qb_hits                   integer,
    def_interceptions             integer,
    def_interception_yards        integer,
    def_pass_defended             integer,
    def_tds                       integer,
    def_fumbles                   integer,
    def_safeties                  integer,
    fumble_recovery_own           integer,
    fumble_recovery_yards_own     integer,
    fumble_recovery_opp           integer,
    fumble_recovery_yards_opp     integer,
    fumble_recovery_tds           integer,
    penalties                     integer,
    penalty_yards                 integer,
    primary key (player_id, game_id)
);

create table player_special_teams_stats (
    player_id             text references players(player_id),
    game_id               text references games(game_id),
    team                  text,
    opponent_team         text,
    -- kicking
    fg_made               integer,
    fg_att                integer,
    fg_missed             integer,
    fg_blocked            integer,
    fg_long               integer,
    fg_pct                real,
    fg_made_0_19          integer,
    fg_made_20_29         integer,
    fg_made_30_39         integer,
    fg_made_40_49         integer,
    fg_made_50_59         integer,
    fg_made_60_           integer,
    fg_made_70_           integer,   -- derived by parsing fg_made_list; nflverse's own buckets cap at "60+"
    fg_missed_0_19        integer,
    fg_missed_20_29       integer,
    fg_missed_30_39       integer,
    fg_missed_40_49       integer,
    fg_missed_50_59       integer,
    fg_missed_60_         integer,
    fg_made_list          text,
    fg_missed_list        text,
    fg_blocked_list       text,
    pat_made              integer,
    pat_att               integer,
    pat_missed            integer,
    pat_blocked           integer,
    pat_pct               real,
    gwfg_made             integer,
    gwfg_att              integer,
    gwfg_missed           integer,
    gwfg_blocked          integer,
    -- punting
    pt_att                integer,
    pt_blocked            integer,
    pt_long               integer,
    pt_yards              integer,
    pt_net_yards          integer,
    pt_inside_20          integer,
    pt_out_of_bounds      integer,
    pt_downed             integer,
    pt_touchback          integer,
    pt_fair_caught        integer,
    pt_returned           integer,
    pt_return_yards       integer,
    pt_return_tds         integer,
    -- returns
    punt_returns          integer,
    punt_return_yards     integer,
    kickoff_returns       integer,
    kickoff_return_yards  integer,
    special_teams_tds     integer,
    penalties             integer,
    penalty_yards         integer,
    primary key (player_id, game_id)
);

-- College football reference data (cfbfastR-data), scoped to recent seasons —
-- enough to cover any active NFL player's own college career.

create table college_rosters (
    athlete_id   text,
    player_id    text references players(player_id),  -- null if this college player never reached the NFL
    first_name   text,
    last_name    text,
    full_name    text,
    team         text,
    position     text,
    jersey       text,
    class_year   text,
    height       integer,
    weight       integer,
    home_city    text,
    home_state   text,
    headshot_url text,
    season       integer,
    primary key (athlete_id, season)
);

create table college_player_season_stats (
    -- derived — aggregated from cfbfastR-data's play-by-play-level player_stats
    -- export, not a native season-totals table. See old build_college_stats.py
    -- for the aggregation logic when porting the ETL.
    athlete_id  text,
    player_id   text references players(player_id),
    player_name text,
    team        text,
    season      integer,
    games       integer,
    rush_att    integer,
    rush_yds    integer,
    rush_td     integer,
    targets     integer,
    receptions  integer,
    rec_yds     integer,
    rec_td      integer,
    pass_comp   integer,
    pass_att    integer,
    pass_yds    integer,
    pass_td     integer,
    pass_int    integer,
    def_int     integer,
    def_sacks   integer,
    def_ff      integer,  -- forced fumbles
    def_fr      integer,  -- fumble recoveries
    def_pbu     integer,  -- pass breakups
    fg_made     integer,
    fg_att      integer,
    fg_missed   integer,
    fg_blocked  integer,
    primary key (athlete_id, season)
);

-- Roster/depth-chart/injury "current state" tables — one row per player,
-- overwritten each ETL run to reflect the latest snapshot.

create table active_roster (
    player_id                text primary key references players(player_id),
    team                      text,
    position                  text,
    depth_chart_position      text,
    status                    text,  -- ACT/INA/CUT/RES/DEV/RET/TRD/TRC/EXE (nflverse's own codes)
    status_description_abbr  text,
    jersey_number             integer,
    full_name                 text,
    season                    integer,
    week                      integer,
    as_of                     timestamptz
);

create table current_injury_report (
    player_id                text primary key references players(player_id),
    team                      text,
    position                  text,
    full_name                 text,
    report_primary_injury    text,
    report_secondary_injury  text,
    report_status             text,  -- Out / Doubtful / Questionable
    practice_status           text,
    season                    integer,
    week                      integer,
    as_of                     timestamptz
);

create table depth_chart_ranks (
    team            text,
    player_id       text references players(player_id),
    player_name     text,
    position_group  text,
    position_name   text,
    position_abbr   text,
    position_slot   text,
    rank            integer,  -- 1 = starter, 2 = second string, ...
    source          text default 'nflverse_espn',
    as_of           timestamptz,
    primary key (team, position_name, position_slot, rank)
);

-- History / append-only logs — never overwritten, grow every ETL run.

create table injuries (
    season                     integer,
    week                       integer,
    season_type                text,
    game_type                  text,
    team                       text,
    player_id                  text references players(player_id),
    position                   text,
    full_name                  text,
    report_primary_injury     text,
    report_secondary_injury   text,
    report_status              text,
    practice_primary_injury   text,
    practice_secondary_injury text,
    practice_status            text,
    primary key (season, week, player_id)
);

create table depth_chart_history (
    dt              timestamptz,
    team            text,
    player_id       text references players(player_id),
    player_name     text,
    espn_id         text,
    position_group  text,
    position_name   text,
    position_abbr   text,
    position_slot   text,
    rank            integer,
    source          text default 'nflverse_espn',
    primary key (dt, team, position_name, position_slot, rank)
);

create table trades (
    trade_id       integer,
    season         integer,
    trade_date     date,
    gave_team      text,  -- team giving up this asset
    received_team  text,  -- team receiving this asset
    pick_season    integer,  -- null if this row is a player, not a pick
    pick_round     integer,
    pick_number    integer,
    conditional    boolean,
    pfr_id         text,  -- null if this row is a pick, not a player
    pfr_name       text,
    player_id      text references players(player_id),
    primary key (trade_id, gave_team, received_team, pick_season, pick_round, pfr_id)
);

-- Row Level Security: public read-only. Only the service_role key (used
-- solely by the ETL pipeline) can write, since it bypasses RLS entirely.

do $$
declare
    t text;
begin
    for t in
        select unnest(array[
            'teams', 'players', 'games', 'player_snap_counts',
            'player_offense_stats', 'player_defense_stats', 'player_special_teams_stats',
            'college_rosters', 'college_player_season_stats',
            'active_roster', 'current_injury_report', 'depth_chart_ranks',
            'injuries', 'depth_chart_history', 'trades'
        ])
    loop
        execute format('alter table %I enable row level security', t);
        execute format(
            'create policy "Public read access" on %I for select to anon, authenticated using (true)',
            t
        );
    end loop;
end $$;
