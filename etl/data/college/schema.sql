-- Another Fantasy — college football reference data, from cfbfastR-data
-- (github.com/sportsdataverse/cfbfastR-data). Scoped to the last ~10
-- seasons (see YEARS in each build script) — enough to cover any active
-- NFL player's own college career, not the full 2004-present history.
--
-- player_id is this project's own gsis_id, resolved by name-matching
-- against data/nflverse/reference/players.csv (see build_college_rosters.py
-- for the full reasoning) — NULL for a college player who never reached
-- the NFL. athlete_id is cfbfastR's own id, always present, the real
-- primary key for a college career regardless of NFL resolution.

CREATE TABLE IF NOT EXISTS college_rosters (
    athlete_id      TEXT,
    player_id       TEXT,    -- gsis_id, NULL if unresolved
    first_name      TEXT,
    last_name       TEXT,
    full_name       TEXT,
    team            TEXT,
    position        TEXT,
    jersey          TEXT,
    class_year      TEXT,    -- cfbfastR's own "year" column (1=freshman .. 5=redshirt senior, roughly)
    height          INTEGER,
    weight          INTEGER,
    home_city       TEXT,
    home_state      TEXT,
    headshot_url    TEXT,    -- ESPN's college-football headshot CDN
    season          INTEGER,
    PRIMARY KEY (athlete_id, season)
);

CREATE TABLE IF NOT EXISTS college_player_season_stats (
    -- DERIVED — aggregated here from cfbfastR-data's play-by-play-level
    -- player_stats export (one row per PLAY, split across per-role
    -- columns), not a native season-totals table nflverse-style sources
    -- usually provide directly. See build_college_stats.py for the
    -- aggregation logic (touchdown attribution in particular needs
    -- cross-column co-occurrence, not a single "touchdown type" field).
    -- No raw tackle counts exist in the source data — def_* below is
    -- limited to turnover/pressure/coverage events it actually tracks.
    athlete_id      TEXT,
    player_id       TEXT,    -- gsis_id, NULL if unresolved
    player_name     TEXT,
    team            TEXT,
    season          INTEGER,
    games           INTEGER,
    rush_att        INTEGER,
    rush_yds        INTEGER,
    rush_td         INTEGER,
    targets         INTEGER,
    receptions      INTEGER,
    rec_yds         INTEGER,
    rec_td          INTEGER,
    pass_comp       INTEGER,
    pass_att        INTEGER,
    pass_yds        INTEGER,
    pass_td         INTEGER,
    pass_int        INTEGER,
    def_int         INTEGER,
    def_sacks       INTEGER,
    def_ff          INTEGER,  -- forced fumbles
    def_fr          INTEGER,  -- fumble recoveries
    def_pbu         INTEGER,  -- pass breakups
    fg_made         INTEGER,
    fg_att          INTEGER,
    fg_missed       INTEGER,
    fg_blocked      INTEGER,
    PRIMARY KEY (athlete_id, season)
);
