#!/usr/bin/env python3
"""
Pushes the local SQLite databases built by the data/ build scripts into the
Supabase Postgres schema (supabase/migrations/0001_core_schema.sql).

Each table is a full TRUNCATE + reload — matches how the source build
scripts already treat their own SQLite tables (safe to rerun, never
incrementally patched), so there's no upsert/merge logic to get wrong here.

player_id values are sanitized against the actual players table before
loading anything else, so a bad crosswalk match becomes a NULL foreign key
(allowed) instead of a failed COPY partway through the run.

Requires: psql on PATH (or PSQL_BIN env var), and SUPABASE_DB_URL env var
(a direct/pooler Postgres connection string — NOT the API URL/keys).

Usage:
    SUPABASE_DB_URL=postgresql://... python3 etl/sync_to_supabase.py
"""
import csv
import os
import sqlite3
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DB_DIR = ROOT / "db"
PSQL = os.environ.get("PSQL_BIN", "psql")
CONN = os.environ.get("SUPABASE_DB_URL")

if not CONN:
    sys.exit("SUPABASE_DB_URL is not set")


def sqlite_rows(db_path, table, columns):
    if not db_path.exists():
        return
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cur = conn.execute(f"SELECT {', '.join(columns)} FROM {table}")
    for row in cur:
        yield [row[c] for c in columns]
    conn.close()


# nflverse season DBs, one per season we retain -- adding a season means
# adding it here (and to SEASONS in the ETL workflow) and nowhere else.
SEASON_DBS = [DB_DIR / "nfl_2024.db", DB_DIR / "nfl_2025.db", DB_DIR / "nfl_2026.db"]


def season_sources(table):
    return [(db, table) for db in SEASON_DBS]


# (postgres_table, columns in destination order, [(sqlite_db, sqlite_table)], dedupe_key or None)
TABLE_SPECS = [
    ("teams", ["team_abbr", "team_name", "team_nick", "conference", "division"],
     season_sources("teams"), "team_abbr"),

    ("players", ["player_id", "display_name", "first_name", "last_name", "position",
                 "position_group", "height", "weight", "college_name", "birth_date",
                 "rookie_season", "jersey_number", "pfr_id"],
     season_sources("players"), "player_id"),

    ("games", ["game_id", "season", "week", "game_type", "gameday", "weekday", "gametime",
               "home_team", "away_team", "home_score", "away_score", "roof", "surface",
               "temp", "wind", "spread_line", "total_line", "referee", "stadium"],
     season_sources("games"), None),

    ("player_snap_counts", ["player_id", "game_id", "team", "position", "offense_snaps",
                            "offense_pct", "defense_snaps", "defense_pct", "st_snaps", "st_pct"],
     season_sources("player_snap_counts"), None),

    ("player_offense_stats", [
        "player_id", "game_id", "team", "opponent_team", "completions", "attempts",
        "passing_yards", "passing_tds", "passing_interceptions", "sacks_suffered",
        "sack_yards_lost", "sack_fumbles", "sack_fumbles_lost", "passing_air_yards",
        "passing_yards_after_catch", "passing_first_downs", "passing_epa", "passing_cpoe",
        "passing_2pt_conversions", "pacr", "carries", "rushing_yards", "rushing_tds",
        "rushing_fumbles", "rushing_fumbles_lost", "rushing_first_downs", "rushing_epa",
        "rushing_2pt_conversions", "receptions", "targets", "receiving_yards", "receiving_tds",
        "receiving_fumbles", "receiving_fumbles_lost", "receiving_air_yards",
        "receiving_yards_after_catch", "receiving_first_downs", "receiving_epa",
        "receiving_2pt_conversions", "racr", "target_share", "air_yards_share", "wopr",
        "fantasy_points", "fantasy_points_ppr", "passing_20", "passing_40", "rushing_20",
        "rushing_40", "receiving_20", "receiving_40", "rushing_yards_after_contact",
        "penalties", "penalty_yards",
    ], season_sources("player_offense_stats"), None),

    ("player_defense_stats", [
        "player_id", "game_id", "team", "opponent_team", "def_tackles_solo",
        "def_tackles_with_assist", "def_tackle_assists", "def_tackles_for_loss",
        "def_tackles_for_loss_yards", "def_fumbles_forced", "def_sacks", "def_sack_yards",
        "def_qb_hits", "def_interceptions", "def_interception_yards", "def_pass_defended",
        "def_tds", "def_fumbles", "def_safeties", "fumble_recovery_own",
        "fumble_recovery_yards_own", "fumble_recovery_opp", "fumble_recovery_yards_opp",
        "fumble_recovery_tds", "penalties", "penalty_yards",
    ], season_sources("player_defense_stats"), None),

    ("player_special_teams_stats", [
        "player_id", "game_id", "team", "opponent_team", "fg_made", "fg_att", "fg_missed",
        "fg_blocked", "fg_long", "fg_pct", "fg_made_0_19", "fg_made_20_29", "fg_made_30_39",
        "fg_made_40_49", "fg_made_50_59", "fg_made_60_", "fg_made_70_", "fg_missed_0_19",
        "fg_missed_20_29", "fg_missed_30_39", "fg_missed_40_49", "fg_missed_50_59",
        "fg_missed_60_", "fg_made_list", "fg_missed_list", "fg_blocked_list", "pat_made",
        "pat_att", "pat_missed", "pat_blocked", "pat_pct", "gwfg_made", "gwfg_att",
        "gwfg_missed", "gwfg_blocked", "pt_att", "pt_blocked", "pt_long", "pt_yards",
        "pt_net_yards", "pt_inside_20", "pt_out_of_bounds", "pt_downed", "pt_touchback",
        "pt_fair_caught", "pt_returned", "pt_return_yards", "pt_return_tds", "punt_returns",
        "punt_return_yards", "kickoff_returns", "kickoff_return_yards", "special_teams_tds",
        "penalties", "penalty_yards",
    ], season_sources("player_special_teams_stats"), None),

    ("college_rosters", ["athlete_id", "player_id", "first_name", "last_name", "full_name",
                         "team", "position", "jersey", "class_year", "height", "weight",
                         "home_city", "home_state", "headshot_url", "season"],
     [(DB_DIR / "college.db", "college_rosters")], None),

    ("college_player_season_stats", ["athlete_id", "player_id", "player_name", "team", "season",
                                      "games", "rush_att", "rush_yds", "rush_td", "targets",
                                      "receptions", "rec_yds", "rec_td", "pass_comp", "pass_att",
                                      "pass_yds", "pass_td", "pass_int", "def_int", "def_sacks",
                                      "def_ff", "def_fr", "def_pbu", "fg_made", "fg_att",
                                      "fg_missed", "fg_blocked"],
     [(DB_DIR / "college.db", "college_player_season_stats")], None),

    ("active_roster", ["player_id", "team", "position", "depth_chart_position", "status",
                       "status_description_abbr", "jersey_number", "full_name", "season",
                       "week", "as_of"],
     [(DB_DIR / "player_management_active.db", "active_roster")], None),

    ("current_injury_report", ["player_id", "team", "position", "full_name",
                               "report_primary_injury", "report_secondary_injury",
                               "report_status", "practice_status", "season", "week", "as_of"],
     [(DB_DIR / "player_management_active.db", "current_injury_report")], None),

    ("depth_chart_ranks", ["team", "player_id", "player_name", "position_group", "position_name",
                           "position_abbr", "position_slot", "rank", "source", "as_of"],
     [(DB_DIR / "player_management_active.db", "depth_chart_ranks")], None),

    ("injuries", ["season", "week", "season_type", "game_type", "team", "player_id", "position",
                 "full_name", "report_primary_injury", "report_secondary_injury", "report_status",
                 "practice_primary_injury", "practice_secondary_injury", "practice_status"],
     [(DB_DIR / "player_management_history.db", "injuries")], None),

    ("depth_chart_history", ["dt", "team", "player_id", "player_name", "espn_id", "position_group",
                             "position_name", "position_abbr", "position_slot", "rank", "source"],
     [(DB_DIR / "player_management_history.db", "depth_chart_history")], None),

    ("trades", ["trade_id", "season", "trade_date", "gave_team", "received_team", "pick_season",
               "pick_round", "pick_number", "conditional", "pfr_id", "pfr_name", "player_id"],
     [(DB_DIR / "player_management_history.db", "trades")], None),
]

PLAYER_ID_COLUMN_BY_TABLE = {
    "player_snap_counts": "player_id", "player_offense_stats": "player_id",
    "player_defense_stats": "player_id", "player_special_teams_stats": "player_id",
    "college_rosters": "player_id", "college_player_season_stats": "player_id",
    "active_roster": "player_id", "current_injury_report": "player_id",
    "depth_chart_ranks": "player_id", "injuries": "player_id",
    "depth_chart_history": "player_id", "trades": "player_id",
}

# Primary-key columns per table, so a row can never be COPY'd with a null PK
# column — either because the source had a blank row (seen once in nflverse's
# own players.csv), or because player_id sanitization nulled out an unmatched
# crosswalk that happens to sit inside this table's PK (not just a loose FK).
PK_COLUMNS = {
    "teams": ["team_abbr"], "players": ["player_id"], "games": ["game_id"],
    "player_snap_counts": ["player_id", "game_id"],
    "player_offense_stats": ["player_id", "game_id"],
    "player_defense_stats": ["player_id", "game_id"],
    "player_special_teams_stats": ["player_id", "game_id"],
    "college_rosters": ["athlete_id", "season"],
    "college_player_season_stats": ["athlete_id", "season"],
    "active_roster": ["player_id"], "current_injury_report": ["player_id"],
    "depth_chart_ranks": ["team", "position_name", "position_slot", "rank"],
    "injuries": ["season", "week", "player_id"],
    "depth_chart_history": ["dt", "team", "position_name", "position_slot", "rank"],
    "trades": ["trade_id", "gave_team", "received_team", "pick_season", "pick_round", "pfr_id"],
}


def run_psql(sql):
    subprocess.run([PSQL, CONN, "-v", "ON_ERROR_STOP=1", "-c", sql], check=True)


def copy_csv(pg_table, columns, csv_path):
    col_list = ", ".join(columns)
    subprocess.run(
        [PSQL, CONN, "-v", "ON_ERROR_STOP=1", "-c",
         f"\\copy {pg_table}({col_list}) FROM '{csv_path}' WITH (FORMAT csv, HEADER true, NULL '')"],
        check=True,
    )


def main():
    all_tables = [spec[0] for spec in TABLE_SPECS]
    print(f"Truncating {len(all_tables)} tables...")
    run_psql(f"TRUNCATE {', '.join(all_tables)} RESTART IDENTITY CASCADE;")

    valid_player_ids = set()

    with tempfile.TemporaryDirectory() as tmp:
        for pg_table, columns, sources, dedupe_key in TABLE_SPECS:
            rows_by_key = {} if dedupe_key else None
            all_rows = [] if not dedupe_key else None

            for db_path, sqlite_table in sources:
                for row in sqlite_rows(db_path, sqlite_table, columns):
                    if pg_table in PLAYER_ID_COLUMN_BY_TABLE:
                        idx = columns.index(PLAYER_ID_COLUMN_BY_TABLE[pg_table])
                        if row[idx] and row[idx] not in valid_player_ids:
                            row[idx] = None
                    if dedupe_key:
                        rows_by_key[row[columns.index(dedupe_key)]] = row
                    else:
                        all_rows.append(row)

            final_rows = list(rows_by_key.values()) if dedupe_key else all_rows

            pk_indexes = [columns.index(c) for c in PK_COLUMNS[pg_table]]
            final_rows = [r for r in final_rows if all(r[i] not in (None, "") for i in pk_indexes)]

            csv_path = Path(tmp) / f"{pg_table}.csv"
            with open(csv_path, "w", newline="", encoding="utf-8") as f:
                writer = csv.writer(f)
                writer.writerow(columns)
                writer.writerows(final_rows)

            print(f"  {pg_table}: {len(final_rows)} rows")
            copy_csv(pg_table, columns, csv_path)

            if pg_table == "players":
                pid_idx = columns.index("player_id")
                valid_player_ids = {r[pid_idx] for r in final_rows if r[pid_idx]}

    print("Refreshing materialized views...")
    # Order matters: team_share_stats depends on team_season_stats AND on
    # the player_season_* views, so it must refresh last.
    for view in ["team_game_stats", "team_season_stats", "player_season_offense_stats",
                 "player_season_defense_stats", "player_season_special_teams_stats",
                 "player_season_snap_counts", "team_share_stats"]:
        run_psql(f"REFRESH MATERIALIZED VIEW {view};")

    print("Done.")


if __name__ == "__main__":
    main()
