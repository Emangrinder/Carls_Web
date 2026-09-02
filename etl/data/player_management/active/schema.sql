-- Another Fantasy — active/current-state player management data.
-- Deliberately separate from db/player_management_history.db: these tables
-- are SNAPSHOTS of the latest available week, fully replaced on every build
-- run, not an accumulating log. If you want trend/history, use the history
-- db instead — this one only ever answers "what's true right now."

CREATE TABLE IF NOT EXISTS active_roster (
    player_id               TEXT,   -- gsis_id
    team                    TEXT,
    position                TEXT,
    depth_chart_position    TEXT,
    status                  TEXT,   -- ACT/INA/CUT/RES/DEV/RET/TRD/TRC/EXE (nflverse's own codes)
    status_description_abbr TEXT,
    jersey_number           INTEGER,
    full_name               TEXT,
    season                  INTEGER,
    week                    INTEGER,  -- which week this snapshot reflects
    as_of                   TEXT,     -- when this row was written (build-time timestamp)
    PRIMARY KEY (player_id)
);

CREATE TABLE IF NOT EXISTS current_injury_report (
    player_id                TEXT,   -- gsis_id
    team                     TEXT,
    position                 TEXT,
    full_name                TEXT,
    report_primary_injury    TEXT,
    report_secondary_injury  TEXT,
    report_status            TEXT,   -- Out / Doubtful / Questionable
    practice_status           TEXT,
    season                    INTEGER,
    week                       INTEGER,  -- which week this snapshot reflects
    as_of                       TEXT,
    PRIMARY KEY (player_id)
);

-- Same "always current" model as current_injury_report above, but sourced
-- from ESPN's live team-roster feed instead of nflverse's official WEEKLY
-- injury report — see build_espn_injuries.py's docstring for why that gap
-- matters (off-season/camp injuries have nowhere to land in the official
-- report until the season's Week 1). A supplement to current_injury_report,
-- not a replacement for it.
CREATE TABLE IF NOT EXISTS current_injury_report_espn (
    espn_athlete_id  TEXT,
    player_id        TEXT,   -- gsis_id, crosswalked via players.csv's espn_id column; NULL if unmatched
    team             TEXT,
    position         TEXT,
    full_name        TEXT,
    status           TEXT,   -- ESPN's own status text (Questionable/Doubtful/Out/IR/...)
    reported_date    TEXT,   -- ISO date ESPN attaches to this injury entry
    as_of            TEXT,
    PRIMARY KEY (espn_athlete_id)
);

-- Latest depth-chart snapshot only (see db/player_management_history.db's
-- depth_chart_history for the full accumulating log this is drawn from).
-- Source is nflverse's own ESPN-derived depth chart feed for now; the
-- eventual multi-vendor version (ESPN/CBS/team sites, reliability-weighted)
-- is planned but not implemented yet — see the planning doc.
CREATE TABLE IF NOT EXISTS depth_chart_ranks (
    team              TEXT,
    player_id         TEXT,    -- gsis_id
    player_name       TEXT,
    position_group    TEXT,
    position_name     TEXT,
    position_abbr     TEXT,
    position_slot     TEXT,
    rank               INTEGER,  -- 1 = starter, 2 = second string, ...
    source              TEXT DEFAULT 'nflverse_espn',
    as_of                TEXT,     -- dt of the snapshot this reflects
    PRIMARY KEY (team, position_name, position_slot, rank)
);

-- ESPN's depth chart pulled DIRECTLY (build_espn_depth_chart.py), kept in
-- its own table rather than merged into depth_chart_ranks above — see that
-- script's docstring for why (same underlying vendor as nflverse_espn,
-- just fresher, not a genuinely independent source; a real second vendor
-- still needs CBS/team-site readers per PLAN.md).
CREATE TABLE IF NOT EXISTS depth_chart_ranks_espn (
    team              TEXT,
    player_id         TEXT,    -- gsis_id; NULL if unmatched via espn_id crosswalk
    player_name       TEXT,
    position_group    TEXT,    -- ESPN's formation name, e.g. "Base 3-4 D"
    position_name     TEXT,
    position_abbr     TEXT,
    position_slot     TEXT,    -- ESPN's own slot key (e.g. "lde") — not comparable to nflverse's slot ids
    rank               INTEGER,  -- 1 = starter, 2 = second string, ...
    as_of                TEXT,
    PRIMARY KEY (team, position_name, position_slot, rank)
);
