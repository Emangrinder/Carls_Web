#!/usr/bin/env python3
"""
Builds a local SQLite DB from nflverse-data for one season, weeks 1-18 (REG only).
Source: https://github.com/nflverse/nflverse-data (public GitHub releases)

Usage:
    python3 data/nflverse/build_db.py [--season 2025]
"""
import argparse
import csv
import gzip
import subprocess
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
RAW_DIR = ROOT / "data" / "nflverse" / "raw"              # season-specific files go in RAW_DIR/<season>/
REFERENCE_DIR = ROOT / "data" / "nflverse" / "reference"  # cross-season files: teams, players, games, logos
DB_DIR = ROOT / "db"
SCHEMA_PATH = Path(__file__).resolve().parent / "schema.sql"

RELEASE_BASE = "https://github.com/nflverse/nflverse-data/releases/download"

MIN_WEEK, MAX_WEEK = 1, 18


def download(url: str, dest: Path) -> Path:
    if dest.exists():
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    print(f"  downloading {url}")
    subprocess.run(["curl", "-sL", "-o", str(dest), url], check=True)
    return dest


def download_optional(url: str, dest: Path):
    """Like download(), but for per-season files that may not exist yet --
    e.g. stats_player_week_<season> before that season's first game has
    been played. Returns None instead of raising, and never caches a failed
    attempt, so a later run picks it up as soon as nflverse actually
    publishes it."""
    if dest.exists():
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    print(f"  downloading {url}")
    result = subprocess.run(["curl", "-sL", "-f", "-o", str(dest), url])
    if result.returncode != 0:
        dest.unlink(missing_ok=True)
        print(f"  not available yet, skipping: {url}")
        return None
    return dest


def read_csv_rows(path):
    if path is None:
        return
    opener = gzip.open if path.suffix == ".gz" else open
    with opener(path, "rt", newline="", encoding="utf-8") as f:
        yield from csv.DictReader(f)


def to_int(v):
    if v is None or v == "":
        return None
    try:
        return int(float(v))
    except ValueError:
        return None


def to_float(v):
    if v is None or v == "":
        return None
    try:
        return float(v)
    except ValueError:
        return None


def to_text(v):
    return v if v not in (None, "") else None


def count_fg_made_ge(fg_made_list_str, min_yards: int) -> int:
    """nflverse's own fg_made_* distance buckets cap out at fg_made_60_
    ("60 yards or more") — there's no 70+ split in their release, so this
    counts it ourselves from fg_made_list, their semicolon-separated list
    of individual made-FG distances (e.g. "35;51")."""
    if not fg_made_list_str:
        return 0
    count = 0
    for part in fg_made_list_str.split(";"):
        part = part.strip()
        if not part:
            continue
        try:
            if float(part) >= min_yards:
                count += 1
        except ValueError:
            continue
    return count


def any_nonzero(row: dict, cols: list[str]) -> bool:
    for c in cols:
        val = to_float(row.get(c))
        if val:
            return True
    return False


def insert_row(cur, table: str, values: dict):
    cols = list(values.keys())
    placeholders = ",".join(["?"] * len(cols))
    sql = f"INSERT OR REPLACE INTO {table} ({','.join(cols)}) VALUES ({placeholders})"
    cur.execute(sql, [values[c] for c in cols])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--season", type=int, default=2025)
    args = parser.parse_args()
    season = args.season

    db_path = DB_DIR / f"nfl_{season}.db"
    if db_path.exists():
        db_path.unlink()
    DB_DIR.mkdir(parents=True, exist_ok=True)

    print(f"Building {db_path} for season {season}, weeks {MIN_WEEK}-{MAX_WEEK} (REG)")

    conn = sqlite3.connect(db_path)
    conn.executescript(SCHEMA_PATH.read_text())
    cur = conn.cursor()

    # ------------------------------------------------------------------
    # 1. Download source files
    # ------------------------------------------------------------------
    print("Downloading source files...")
    season_dir = RAW_DIR / str(season)
    teams_csv = download(f"{RELEASE_BASE}/teams/teams_colors_logos.csv", REFERENCE_DIR / "teams_colors_logos.csv")
    players_csv = download(f"{RELEASE_BASE}/players/players.csv", REFERENCE_DIR / "players.csv")
    games_csv = download(f"{RELEASE_BASE}/schedules/games.csv", REFERENCE_DIR / "games.csv")
    stats_week_csv = download_optional(
        f"{RELEASE_BASE}/stats_player/stats_player_week_{season}.csv.gz",
        season_dir / f"stats_player_week_{season}.csv.gz",
    )
    snap_counts_csv = download_optional(
        f"{RELEASE_BASE}/snap_counts/snap_counts_{season}.csv.gz",
        season_dir / f"snap_counts_{season}.csv.gz",
    )

    # ------------------------------------------------------------------
    # 2. teams
    # ------------------------------------------------------------------
    print("Loading teams...")
    team_abbrs_seen = set()
    for row in read_csv_rows(teams_csv):
        abbr = row["team_abbr"]
        if abbr in team_abbrs_seen:
            continue
        team_abbrs_seen.add(abbr)
        cur.execute(
            "INSERT OR IGNORE INTO teams (team_abbr, team_name, team_nick, conference, division) "
            "VALUES (?, ?, ?, ?, ?)",
            (abbr, row["team_name"], row["team_nick"], row["team_conf"], row["team_division"]),
        )

    # ------------------------------------------------------------------
    # 3. games (season, REG weeks 1-18 + postseason WC/DIV/CON/SB) + coaches
    #
    # Postseason games are included here (schedule/results only) even
    # though player-level stat tables below stay REG-only -- their own
    # in_scope() checks season_type == "REG" independently of
    # game_ids_in_scope, so this doesn't leak postseason stats in.
    # ------------------------------------------------------------------
    print("Loading games + coaches...")
    coach_id_by_name = {}
    POSTSEASON_TYPES = {"WC", "DIV", "CON", "SB"}

    def get_coach_id(name):
        if not name:
            return None
        if name not in coach_id_by_name:
            cur.execute("INSERT OR IGNORE INTO coaches (coach_name) VALUES (?)", (name,))
            cur.execute("SELECT coach_id FROM coaches WHERE coach_name = ?", (name,))
            coach_id_by_name[name] = cur.fetchone()[0]
        return coach_id_by_name[name]

    game_ids_in_scope = set()
    for row in read_csv_rows(games_csv):
        if row["season"] != str(season):
            continue
        week = to_int(row["week"])
        if row["game_type"] == "REG":
            if week is None or not (MIN_WEEK <= week <= MAX_WEEK):
                continue
        elif row["game_type"] in POSTSEASON_TYPES:
            if week is None:
                continue
        else:
            continue
        game_ids_in_scope.add(row["game_id"])
        home_coach_id = get_coach_id(to_text(row["home_coach"]))
        away_coach_id = get_coach_id(to_text(row["away_coach"]))
        cur.execute(
            """INSERT INTO games (
                game_id, season, week, game_type, gameday, weekday, gametime,
                home_team, away_team, home_score, away_score,
                home_coach_id, away_coach_id, roof, surface, temp, wind,
                spread_line, total_line, referee, stadium
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                row["game_id"], season, week, row["game_type"], row["gameday"], row["weekday"], row["gametime"],
                row["home_team"], row["away_team"], to_int(row["home_score"]), to_int(row["away_score"]),
                home_coach_id, away_coach_id, to_text(row["roof"]), to_text(row["surface"]),
                to_int(row["temp"]), to_int(row["wind"]),
                to_float(row["spread_line"]), to_float(row["total_line"]),
                to_text(row["referee"]), to_text(row["stadium"]),
            ),
        )
    print(f"  {len(game_ids_in_scope)} games in scope")

    # ------------------------------------------------------------------
    # 4. stats_player_week -> player_offense/defense/special_teams_stats
    # ------------------------------------------------------------------
    print("Loading player weekly stats...")
    OFFENSE_TRIGGER = ["completions", "attempts", "carries", "targets", "receptions"]
    DEFENSE_TRIGGER = [
        "def_tackles_solo", "def_tackles_with_assist", "def_sacks",
        "def_interceptions", "def_pass_defended", "def_fumbles_forced", "def_qb_hits",
    ]
    ST_TRIGGER = ["punt_returns", "kickoff_returns", "fg_att", "pat_att", "pt_att", "special_teams_tds"]

    def in_scope(row):
        if row["season_type"] != "REG":
            return False
        week = to_int(row["week"])
        if week is None or not (MIN_WEEK <= week <= MAX_WEEK):
            return False
        return row["game_id"] in game_ids_in_scope

    # pre-scan (no writes) to find which players we need, so `players` can
    # be populated before any stat table with a player_id FK is written
    relevant_player_ids = set()
    stub_players = {}  # player_id -> (name, position, position_group) for players not in players.csv
    for row in read_csv_rows(stats_week_csv):
        if not in_scope(row):
            continue
        pid = row["player_id"]
        relevant_player_ids.add(pid)
        stub_players[pid] = (row["player_display_name"], row["position"], row["position_group"])

    # ------------------------------------------------------------------
    # 5. players — only the ones relevant to this season/week window
    # ------------------------------------------------------------------
    print("Loading players + building pfr_id crosswalk...")
    pfr_id_to_gsis = {}
    players_inserted = set()

    def insert_player_from_players_csv(row):
        pid = row["gsis_id"]
        cur.execute(
            """INSERT OR IGNORE INTO players (
                player_id, display_name, first_name, last_name, position, position_group,
                height, weight, college_name, birth_date, rookie_season, jersey_number, pfr_id,
                espn_id, headshot_url
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                pid, row["display_name"], row["first_name"], row["last_name"],
                row["position"], row["position_group"], to_int(row["height"]), to_int(row["weight"]),
                row["college_name"], row["birth_date"], to_int(row["rookie_season"]),
                to_int(row["jersey_number"]), row["pfr_id"],
                to_text(row["espn_id"]), to_text(row["headshot"]),
            ),
        )
        players_inserted.add(pid)

    for row in read_csv_rows(players_csv):
        pid = row["gsis_id"]
        if row.get("pfr_id"):
            pfr_id_to_gsis[row["pfr_id"]] = pid
        if pid and pid in relevant_player_ids:
            insert_player_from_players_csv(row)

    missing = relevant_player_ids - players_inserted
    for pid in missing:
        name, pos, pos_group = stub_players[pid]
        cur.execute(
            "INSERT OR IGNORE INTO players (player_id, display_name, position, position_group) VALUES (?,?,?,?)",
            (pid, name, pos, pos_group),
        )
    if missing:
        print(f"  {len(missing)} players not found in players.csv, inserted as stubs")

    # ------------------------------------------------------------------
    # 4a. PFR advanced rushing (yards after contact) -> lookup by (gsis_id, game_id)
    # ------------------------------------------------------------------
    print("Loading PFR advanced rushing (yards after contact)...")
    advrush_csv = download_optional(
        f"{RELEASE_BASE}/pfr_advstats/advstats_week_rush_{season}.csv.gz",
        season_dir / f"advstats_week_rush_{season}.csv.gz",
    )
    rush_yac_by_key = {}
    n_yac_matched = n_yac_unmatched = 0
    for row in read_csv_rows(advrush_csv):
        if row["season"] != str(season) or row["game_type"] != "REG":
            continue
        week = to_int(row["week"])
        if week is None or not (MIN_WEEK <= week <= MAX_WEEK):
            continue
        gsis_id = pfr_id_to_gsis.get(row["pfr_player_id"])
        if gsis_id is None:
            n_yac_unmatched += 1
            continue
        rush_yac_by_key[(gsis_id, row["game_id"])] = to_float(row["rushing_yards_after_contact"])
        n_yac_matched += 1
    print(f"  {n_yac_matched} rushing-YAC rows matched, {n_yac_unmatched} unmatched pfr_id")

    # ------------------------------------------------------------------
    # 4b. now insert the actual stat rows (players table is populated)
    # ------------------------------------------------------------------
    n_off = n_def = n_st = 0
    for row in read_csv_rows(stats_week_csv):
        if not in_scope(row):
            continue
        pid = row["player_id"]

        if any_nonzero(row, OFFENSE_TRIGGER):
            n_off += 1
            insert_row(cur, "player_offense_stats", {
                "player_id": pid, "game_id": row["game_id"], "team": row["team"],
                "opponent_team": row["opponent_team"],
                "completions": to_int(row["completions"]), "attempts": to_int(row["attempts"]),
                "passing_yards": to_int(row["passing_yards"]), "passing_tds": to_int(row["passing_tds"]),
                "passing_interceptions": to_int(row["passing_interceptions"]),
                "sacks_suffered": to_int(row["sacks_suffered"]), "sack_yards_lost": to_int(row["sack_yards_lost"]),
                "sack_fumbles": to_int(row["sack_fumbles"]), "sack_fumbles_lost": to_int(row["sack_fumbles_lost"]),
                "passing_air_yards": to_int(row["passing_air_yards"]),
                "passing_yards_after_catch": to_int(row["passing_yards_after_catch"]),
                "passing_first_downs": to_int(row["passing_first_downs"]),
                "passing_epa": to_float(row["passing_epa"]), "passing_cpoe": to_float(row["passing_cpoe"]),
                "passing_2pt_conversions": to_int(row["passing_2pt_conversions"]), "pacr": to_float(row["pacr"]),
                "carries": to_int(row["carries"]), "rushing_yards": to_int(row["rushing_yards"]),
                "rushing_tds": to_int(row["rushing_tds"]), "rushing_fumbles": to_int(row["rushing_fumbles"]),
                "rushing_fumbles_lost": to_int(row["rushing_fumbles_lost"]),
                "rushing_first_downs": to_int(row["rushing_first_downs"]),
                "rushing_epa": to_float(row["rushing_epa"]),
                "rushing_2pt_conversions": to_int(row["rushing_2pt_conversions"]),
                "receptions": to_int(row["receptions"]), "targets": to_int(row["targets"]),
                "receiving_yards": to_int(row["receiving_yards"]), "receiving_tds": to_int(row["receiving_tds"]),
                "receiving_fumbles": to_int(row["receiving_fumbles"]),
                "receiving_fumbles_lost": to_int(row["receiving_fumbles_lost"]),
                "receiving_air_yards": to_int(row["receiving_air_yards"]),
                "receiving_yards_after_catch": to_int(row["receiving_yards_after_catch"]),
                "receiving_first_downs": to_int(row["receiving_first_downs"]),
                "receiving_epa": to_float(row["receiving_epa"]),
                "receiving_2pt_conversions": to_int(row["receiving_2pt_conversions"]),
                "racr": to_float(row["racr"]), "target_share": to_float(row["target_share"]),
                "air_yards_share": to_float(row["air_yards_share"]), "wopr": to_float(row["wopr"]),
                "fantasy_points": to_float(row["fantasy_points"]),
                "fantasy_points_ppr": to_float(row["fantasy_points_ppr"]),
                "passing_20": to_int(row["passing_20"]), "passing_40": to_int(row["passing_40"]),
                "rushing_20": to_int(row["rushing_20"]), "rushing_40": to_int(row["rushing_40"]),
                "receiving_20": to_int(row["receiving_20"]), "receiving_40": to_int(row["receiving_40"]),
                "rushing_yards_after_contact": rush_yac_by_key.get((pid, row["game_id"])),
                "penalties": to_int(row["penalties"]), "penalty_yards": to_int(row["penalty_yards"]),
            })

        if any_nonzero(row, DEFENSE_TRIGGER):
            n_def += 1
            insert_row(cur, "player_defense_stats", {
                "player_id": pid, "game_id": row["game_id"], "team": row["team"],
                "opponent_team": row["opponent_team"],
                "def_tackles_solo": to_int(row["def_tackles_solo"]),
                "def_tackles_with_assist": to_int(row["def_tackles_with_assist"]),
                "def_tackle_assists": to_int(row["def_tackle_assists"]),
                "def_tackles_for_loss": to_int(row["def_tackles_for_loss"]),
                "def_tackles_for_loss_yards": to_float(row["def_tackles_for_loss_yards"]),
                "def_fumbles_forced": to_int(row["def_fumbles_forced"]),
                "def_sacks": to_float(row["def_sacks"]), "def_sack_yards": to_float(row["def_sack_yards"]),
                "def_qb_hits": to_int(row["def_qb_hits"]), "def_interceptions": to_int(row["def_interceptions"]),
                "def_interception_yards": to_int(row["def_interception_yards"]),
                "def_pass_defended": to_int(row["def_pass_defended"]), "def_tds": to_int(row["def_tds"]),
                "def_fumbles": to_int(row["def_fumbles"]), "def_safeties": to_int(row["def_safeties"]),
                "fumble_recovery_own": to_int(row["fumble_recovery_own"]),
                "fumble_recovery_yards_own": to_int(row["fumble_recovery_yards_own"]),
                "fumble_recovery_opp": to_int(row["fumble_recovery_opp"]),
                "fumble_recovery_yards_opp": to_int(row["fumble_recovery_yards_opp"]),
                "fumble_recovery_tds": to_int(row["fumble_recovery_tds"]),
                "penalties": to_int(row["penalties"]), "penalty_yards": to_int(row["penalty_yards"]),
            })

        if any_nonzero(row, ST_TRIGGER):
            n_st += 1
            insert_row(cur, "player_special_teams_stats", {
                "player_id": pid, "game_id": row["game_id"], "team": row["team"],
                "opponent_team": row["opponent_team"],
                "fg_made": to_int(row["fg_made"]), "fg_att": to_int(row["fg_att"]),
                "fg_missed": to_int(row["fg_missed"]), "fg_blocked": to_int(row["fg_blocked"]),
                "fg_long": to_int(row["fg_long"]), "fg_pct": to_float(row["fg_pct"]),
                "fg_made_0_19": to_int(row["fg_made_0_19"]), "fg_made_20_29": to_int(row["fg_made_20_29"]),
                "fg_made_30_39": to_int(row["fg_made_30_39"]), "fg_made_40_49": to_int(row["fg_made_40_49"]),
                "fg_made_50_59": to_int(row["fg_made_50_59"]), "fg_made_60_": to_int(row["fg_made_60_"]),
                "fg_made_70_": count_fg_made_ge(row["fg_made_list"], 70),
                "fg_missed_0_19": to_int(row["fg_missed_0_19"]), "fg_missed_20_29": to_int(row["fg_missed_20_29"]),
                "fg_missed_30_39": to_int(row["fg_missed_30_39"]), "fg_missed_40_49": to_int(row["fg_missed_40_49"]),
                "fg_missed_50_59": to_int(row["fg_missed_50_59"]), "fg_missed_60_": to_int(row["fg_missed_60_"]),
                "fg_made_list": to_text(row["fg_made_list"]), "fg_missed_list": to_text(row["fg_missed_list"]),
                "fg_blocked_list": to_text(row["fg_blocked_list"]),
                "pat_made": to_int(row["pat_made"]), "pat_att": to_int(row["pat_att"]),
                "pat_missed": to_int(row["pat_missed"]), "pat_blocked": to_int(row["pat_blocked"]),
                "pat_pct": to_float(row["pat_pct"]),
                "gwfg_made": to_int(row["gwfg_made"]), "gwfg_att": to_int(row["gwfg_att"]),
                "gwfg_missed": to_int(row["gwfg_missed"]), "gwfg_blocked": to_int(row["gwfg_blocked"]),
                "pt_att": to_int(row["pt_att"]), "pt_blocked": to_int(row["pt_blocked"]),
                "pt_long": to_int(row["pt_long"]), "pt_yards": to_int(row["pt_yards"]),
                "pt_net_yards": to_int(row["pt_net_yards"]), "pt_inside_20": to_int(row["pt_inside_20"]),
                "pt_out_of_bounds": to_int(row["pt_out_of_bounds"]), "pt_downed": to_int(row["pt_downed"]),
                "pt_touchback": to_int(row["pt_touchback"]), "pt_fair_caught": to_int(row["pt_fair_caught"]),
                "pt_returned": to_int(row["pt_returned"]), "pt_return_yards": to_int(row["pt_return_yards"]),
                "pt_return_tds": to_int(row["pt_return_tds"]),
                "punt_returns": to_int(row["punt_returns"]), "punt_return_yards": to_int(row["punt_return_yards"]),
                "kickoff_returns": to_int(row["kickoff_returns"]),
                "kickoff_return_yards": to_int(row["kickoff_return_yards"]),
                "special_teams_tds": to_int(row["special_teams_tds"]),
                "penalties": to_int(row["penalties"]), "penalty_yards": to_int(row["penalty_yards"]),
            })
    print(f"  offense rows: {n_off}, defense rows: {n_def}, special teams rows: {n_st}")

    # ------------------------------------------------------------------
    # 6. snap_counts (uses PFR ids -> crosswalk to gsis via players.csv)
    # ------------------------------------------------------------------
    print("Loading snap counts...")
    n_snaps = n_snap_unmatched = 0
    for row in read_csv_rows(snap_counts_csv):
        if row["season"] != str(season) or row["game_type"] != "REG":
            continue
        week = to_int(row["week"])
        if week is None or not (MIN_WEEK <= week <= MAX_WEEK):
            continue
        gsis_id = pfr_id_to_gsis.get(row["pfr_player_id"])
        if gsis_id is None:
            n_snap_unmatched += 1
            continue
        if gsis_id not in players_inserted and gsis_id not in missing:
            cur.execute(
                "INSERT OR IGNORE INTO players (player_id, display_name, position) VALUES (?,?,?)",
                (gsis_id, row["player"], row["position"]),
            )
            missing.add(gsis_id)
        cur.execute(
            """INSERT OR IGNORE INTO player_snap_counts (
                player_id, game_id, team, position, offense_snaps, offense_pct,
                defense_snaps, defense_pct, st_snaps, st_pct
            ) VALUES (?,?,?,?,?,?,?,?,?,?)""",
            (
                gsis_id, row["game_id"], row["team"], row["position"],
                to_int(row["offense_snaps"]), to_float(row["offense_pct"]),
                to_int(row["defense_snaps"]), to_float(row["defense_pct"]),
                to_int(row["st_snaps"]), to_float(row["st_pct"]),
            ),
        )
        n_snaps += 1
    print(f"  {n_snaps} snap-count rows loaded, {n_snap_unmatched} unmatched pfr_id (no gsis crosswalk found)")

    conn.commit()

    print("\nRow counts:")
    for table in [
        "teams", "coaches", "players", "games",
        "player_snap_counts", "player_offense_stats", "player_defense_stats", "player_special_teams_stats",
    ]:
        n = cur.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        print(f"  {table:30s} {n}")

    conn.close()
    print(f"\nDone -> {db_path}")


if __name__ == "__main__":
    sys.exit(main())
