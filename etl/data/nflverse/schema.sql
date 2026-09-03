-- Another Fantasy — core schema (per-season box score data).
-- Source: nflverse-data (github.com/nflverse/nflverse-data releases)

PRAGMA foreign_keys = ON;

CREATE TABLE teams (
    team_abbr       TEXT PRIMARY KEY,
    team_name       TEXT,
    team_nick       TEXT,
    conference      TEXT,
    division        TEXT
);

CREATE TABLE coaches (
    coach_id        INTEGER PRIMARY KEY AUTOINCREMENT,
    coach_name      TEXT UNIQUE NOT NULL
);

CREATE TABLE players (
    player_id       TEXT PRIMARY KEY,          -- gsis_id
    display_name    TEXT,
    first_name      TEXT,
    last_name       TEXT,
    position        TEXT,
    position_group  TEXT,
    height          INTEGER,
    weight          INTEGER,
    college_name    TEXT,
    birth_date      TEXT,
    rookie_season   INTEGER,
    jersey_number   INTEGER,
    pfr_id          TEXT,                      -- crosswalk key for snap_counts (PFR ids)
    espn_id         TEXT,
    headshot_url    TEXT                       -- nflverse's own pro headshot CDN URL
);

CREATE TABLE games (
    game_id         TEXT PRIMARY KEY,
    season          INTEGER NOT NULL,
    week            INTEGER NOT NULL,
    game_type       TEXT NOT NULL,
    gameday         TEXT,
    weekday         TEXT,
    gametime        TEXT,
    home_team       TEXT REFERENCES teams(team_abbr),
    away_team       TEXT REFERENCES teams(team_abbr),
    home_score      INTEGER,
    away_score      INTEGER,
    home_coach_id   INTEGER REFERENCES coaches(coach_id),
    away_coach_id   INTEGER REFERENCES coaches(coach_id),
    roof            TEXT,
    surface         TEXT,
    temp            INTEGER,
    wind            INTEGER,
    spread_line     REAL,
    total_line      REAL,
    referee         TEXT,
    stadium         TEXT
);

CREATE TABLE player_snap_counts (
    player_id       TEXT REFERENCES players(player_id),
    game_id         TEXT REFERENCES games(game_id),
    team            TEXT,
    position        TEXT,
    offense_snaps   INTEGER,
    offense_pct     REAL,
    defense_snaps   INTEGER,
    defense_pct     REAL,
    st_snaps        INTEGER,
    st_pct          REAL,
    PRIMARY KEY (player_id, game_id)
);

-- ============================================================
-- Stat layer: a player can have rows in any/all three of these
-- for the same game (e.g. a WR who also returns punts)
-- ============================================================

CREATE TABLE player_offense_stats (
    player_id                    TEXT REFERENCES players(player_id),
    game_id                      TEXT REFERENCES games(game_id),
    team                         TEXT,
    opponent_team                TEXT,
    completions                  INTEGER,
    attempts                     INTEGER,
    passing_yards                INTEGER,
    passing_tds                  INTEGER,
    passing_interceptions        INTEGER,
    sacks_suffered                INTEGER,
    sack_yards_lost                INTEGER,
    sack_fumbles                    INTEGER,
    sack_fumbles_lost                INTEGER,
    passing_air_yards                 INTEGER,
    passing_yards_after_catch          INTEGER,
    passing_first_downs                 INTEGER,
    passing_epa                          REAL,
    passing_cpoe                          REAL,
    passing_2pt_conversions      INTEGER,
    pacr                          REAL,
    carries                      INTEGER,
    rushing_yards                INTEGER,
    rushing_tds                  INTEGER,
    rushing_fumbles              INTEGER,
    rushing_fumbles_lost          INTEGER,
    rushing_first_downs            INTEGER,
    rushing_epa                     REAL,
    rushing_2pt_conversions      INTEGER,
    receptions                   INTEGER,
    targets                      INTEGER,
    receiving_yards              INTEGER,
    receiving_tds                INTEGER,
    receiving_fumbles            INTEGER,
    receiving_fumbles_lost        INTEGER,
    receiving_air_yards            INTEGER,
    receiving_yards_after_catch     INTEGER,
    receiving_first_downs            INTEGER,
    receiving_epa                     REAL,
    receiving_2pt_conversions    INTEGER,
    racr                          REAL,
    target_share                  REAL,
    air_yards_share                REAL,
    wopr                            REAL,
    fantasy_points                REAL,
    fantasy_points_ppr             REAL,
    passing_20                   INTEGER,       -- completions of 20+ air yards (long-ball bonus source)
    passing_40                   INTEGER,       -- completions of 40+ air yards
    rushing_20                   INTEGER,       -- carries of 20+ yards
    rushing_40                   INTEGER,       -- carries of 40+ yards
    receiving_20                 INTEGER,       -- receptions of 20+ yards
    receiving_40                 INTEGER,       -- receptions of 40+ yards
    rushing_yards_after_contact  REAL,          -- PFR advanced, 2018+
    penalties                    INTEGER,
    penalty_yards                INTEGER,
    PRIMARY KEY (player_id, game_id)
);

CREATE TABLE player_defense_stats (
    player_id                    TEXT REFERENCES players(player_id),
    game_id                      TEXT REFERENCES games(game_id),
    team                         TEXT,
    opponent_team                TEXT,
    def_tackles_solo             INTEGER,
    def_tackles_with_assist       INTEGER,
    def_tackle_assists             INTEGER,
    def_tackles_for_loss            INTEGER,
    def_tackles_for_loss_yards       REAL,
    def_fumbles_forced                INTEGER,
    def_sacks                          REAL,
    def_sack_yards                      REAL,
    def_qb_hits                          INTEGER,
    def_interceptions                     INTEGER,
    def_interception_yards                 INTEGER,
    def_pass_defended                       INTEGER,
    def_tds                                  INTEGER,
    def_fumbles                               INTEGER,
    def_safeties                               INTEGER,
    fumble_recovery_own           INTEGER,
    fumble_recovery_yards_own      INTEGER,
    fumble_recovery_opp             INTEGER,
    fumble_recovery_yards_opp        INTEGER,
    fumble_recovery_tds               INTEGER,
    penalties                          INTEGER,
    penalty_yards                       INTEGER,
    PRIMARY KEY (player_id, game_id)
);

CREATE TABLE player_special_teams_stats (
    player_id             TEXT REFERENCES players(player_id),
    game_id               TEXT REFERENCES games(game_id),
    team                  TEXT,
    opponent_team         TEXT,
    -- kicking
    fg_made               INTEGER,
    fg_att                INTEGER,
    fg_missed             INTEGER,
    fg_blocked            INTEGER,
    fg_long               INTEGER,
    fg_pct                REAL,
    fg_made_0_19          INTEGER,
    fg_made_20_29         INTEGER,
    fg_made_30_39         INTEGER,
    fg_made_40_49         INTEGER,
    fg_made_50_59         INTEGER,
    fg_made_60_           INTEGER,
    fg_made_70_           INTEGER,      -- DERIVED here (see build_db.py) by parsing fg_made_list;
                                         -- nflverse's own distance buckets cap at fg_made_60_ ("60+"),
                                         -- so this is a subset count, not an nflverse-native column
    fg_missed_0_19        INTEGER,
    fg_missed_20_29       INTEGER,
    fg_missed_30_39       INTEGER,
    fg_missed_40_49       INTEGER,
    fg_missed_50_59       INTEGER,
    fg_missed_60_         INTEGER,
    fg_made_list          TEXT,
    fg_missed_list        TEXT,
    fg_blocked_list       TEXT,
    pat_made              INTEGER,
    pat_att               INTEGER,
    pat_missed            INTEGER,
    pat_blocked           INTEGER,
    pat_pct               REAL,
    gwfg_made             INTEGER,
    gwfg_att              INTEGER,
    gwfg_missed           INTEGER,
    gwfg_blocked          INTEGER,
    -- punting
    pt_att                INTEGER,
    pt_blocked            INTEGER,
    pt_long               INTEGER,
    pt_yards              INTEGER,
    pt_net_yards          INTEGER,
    pt_inside_20          INTEGER,
    pt_out_of_bounds      INTEGER,
    pt_downed             INTEGER,
    pt_touchback          INTEGER,
    pt_fair_caught        INTEGER,
    pt_returned           INTEGER,
    pt_return_yards       INTEGER,
    pt_return_tds         INTEGER,
    -- returns
    punt_returns          INTEGER,
    punt_return_yards     INTEGER,
    kickoff_returns       INTEGER,
    kickoff_return_yards  INTEGER,
    special_teams_tds     INTEGER,
    penalties             INTEGER,
    penalty_yards         INTEGER,
    PRIMARY KEY (player_id, game_id)
);
