-- Another Fantasy — player management data (injuries, trades, depth charts).
-- Lives in its own db (db/player_management.db), deliberately separate from
-- db/nfl_<season>.db (play stats / box scores / PBP) — different concern,
-- different update cadence, different source (nflverse injuries/trades
-- releases vs nflverse's play-by-play ecosystem).

CREATE TABLE IF NOT EXISTS injuries (
    season                      INTEGER,
    week                        INTEGER,
    season_type                 TEXT,
    game_type                   TEXT,
    team                        TEXT,
    player_id                   TEXT,   -- gsis_id, matches player_id everywhere else in this project
    position                    TEXT,
    full_name                   TEXT,
    report_primary_injury       TEXT,
    report_secondary_injury     TEXT,
    report_status                TEXT,  -- Out / Doubtful / Questionable / (blank = no designation)
    practice_primary_injury      TEXT,
    practice_secondary_injury    TEXT,
    practice_status               TEXT,
    PRIMARY KEY (season, week, player_id)
);

CREATE TABLE IF NOT EXISTS trades (
    trade_id        INTEGER,
    season           INTEGER,
    trade_date        TEXT,
    gave_team          TEXT,   -- team giving up this asset
    received_team       TEXT,  -- team receiving this asset
    pick_season           INTEGER,  -- NULL if this row is a player, not a pick
    pick_round              INTEGER,
    pick_number              INTEGER,
    conditional               INTEGER,  -- 1/0, whether the pick was conditional
    pfr_id                     TEXT,   -- NULL if this row is a pick, not a player
    pfr_name                    TEXT,
    player_id                    TEXT,  -- gsis_id, crosswalked from pfr_id via players.csv where possible
    PRIMARY KEY (trade_id, gave_team, received_team, pick_season, pick_round, pfr_id)
);

-- Every depth-chart snapshot nflverse has logged (ESPN-sourced, but polled
-- and timestamped repeatedly by nflverse itself — 221 distinct snapshots for
-- 2025 alone). This is the RAW history; data/player_management/active/
-- build_depth_chart_ranks.py keeps only the latest one as a current-state
-- table. Deliberately not deduplicated here — every dt is kept.
CREATE TABLE IF NOT EXISTS depth_chart_history (
    dt                TEXT,    -- snapshot timestamp, as published by nflverse
    team              TEXT,
    player_id         TEXT,    -- gsis_id
    player_name       TEXT,
    espn_id           TEXT,
    position_group    TEXT,    -- pos_grp, e.g. "Base 4-3 D"
    position_name     TEXT,    -- pos_name, e.g. "Left Defensive End"
    position_abbr     TEXT,    -- pos_abb, e.g. "LDE"
    position_slot     TEXT,    -- pos_slot
    rank               INTEGER,  -- pos_rank: 1 = starter, 2 = second string, ...
    source              TEXT DEFAULT 'nflverse_espn',  -- which vendor this came from
    PRIMARY KEY (dt, team, position_name, position_slot, rank)
);
