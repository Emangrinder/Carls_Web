#!/usr/bin/env python3
"""Computes touchdown-length and other per-play fantasy bonuses that the
per-game aggregate stat tables (player_offense_stats/defense_stats/
special_teams_stats) can't provide, by reading nflverse's own play-by-play
release directly -- it carries individual play yardage, touchdown/return
type flags, and (via td_player_id/fumbled_1_player_id/blocked_player_id)
exactly who scored or gave up each of these bonuses.

Writes a working table, player_game_td_bonus, scoped to the same season
DB build_fantasy_scores.py reads -- run this BEFORE that script so it can
fold these corrections into its category totals. Source formulas:
app/src/fantasyRulesData.js.

Closes these previously-documented gaps:
  - Touchdown length tiers (passing, rushing, receiving, defensive, and
    punt/kickoff-return TDs all have per-length bonus/penalty tiers)
  - Interceptions/fumbles-lost returned for a TD, credited against the
    passer/fumbler (both the flat per-occurrence penalty and the
    per-yard length penalty)
  - Individual credit for blocking a field goal/punt/extra point

Still NOT computable, even with play-by-play data, because they're team-
level (see build_coach_fantasy_scores.py instead):
  - Opponent Penalty First Downs, Opponent Fourth Downs Failed
"""
import argparse
import csv
import gzip
import sqlite3
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
RAW_DIR = ROOT / "data" / "nflverse" / "raw"
DB_DIR = ROOT / "db"
RELEASE_BASE = "https://github.com/nflverse/nflverse-data/releases/download"


def download_optional(url: str, dest: Path):
    """Like build_db.py's own helper -- returns None instead of raising if
    the season's play-by-play file isn't published yet."""
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
    with gzip.open(path, "rt", newline="", encoding="utf-8") as f:
        yield from csv.DictReader(f)


def to_int(v):
    if v is None or v == "":
        return None
    try:
        return int(float(v))
    except ValueError:
        return None


# (max length in this tier, points) -- same shape for passing/rushing/
# receiving TDs; the last tuple's length is only used as a final fallback
# if a return somehow exceeds a normal field (110 yards).
TD_LENGTH_TIERS = [(9, 1), (19, 2), (39, 4), (59, 6), (79, 8), (98, 10), (100, 12)]
PUNT_RETURN_TD_TIERS = [(39, 6), (59, 8), (79, 10), (98, 12), (110, 15)]
KICKOFF_RETURN_TD_TIERS = [(49, 8), (69, 10), (89, 12), (110, 15)]


def tier_lookup(length, tiers):
    if length is None:
        return 0
    for max_len, points in tiers:
        if length <= max_len:
            return points
    return tiers[-1][1]


def build_td_bonuses(season: int):
    db_path = DB_DIR / f"nfl_{season}.db"
    if not db_path.exists():
        print(f"  {db_path} not found, skipping season {season}")
        return

    pbp_csv = download_optional(
        f"{RELEASE_BASE}/pbp/play_by_play_{season}.csv.gz",
        RAW_DIR / str(season) / f"play_by_play_{season}.csv.gz",
    )
    if pbp_csv is None:
        print(f"  no play-by-play data yet for season {season}")
        return

    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    cur.execute("DROP TABLE IF EXISTS player_game_td_bonus")
    cur.execute(
        """CREATE TABLE player_game_td_bonus (
            player_id TEXT NOT NULL,
            game_id TEXT NOT NULL,
            team TEXT,
            passing_bonus REAL NOT NULL DEFAULT 0,
            rushing_bonus REAL NOT NULL DEFAULT 0,
            receiving_bonus REAL NOT NULL DEFAULT 0,
            turnover_bonus REAL NOT NULL DEFAULT 0,
            fumbles_fouls_bonus REAL NOT NULL DEFAULT 0,
            returning_bonus REAL NOT NULL DEFAULT 0,
            PRIMARY KEY (player_id, game_id)
        )"""
    )

    # (player_id, game_id) -> {category: points}, merged across every play
    # that touches that player in that game before a single INSERT per key.
    # `team` is carried alongside so build_fantasy_scores.py can still set
    # it correctly for the rare player whose ONLY stat all game was one of
    # these bonuses (e.g. a backup who did nothing but block a punt) --
    # without it they'd otherwise get a fantasy-points row with no team at
    # all, since none of the three aggregate tables would have inserted
    # them either.
    bonus_by_key = {}

    def add(player_id, game_id, team, category, points):
        if not player_id or not points:
            return
        row = bonus_by_key.setdefault((player_id, game_id), {"team": team})
        row["team"] = row["team"] or team
        row[category] = row.get(category, 0.0) + points

    n_td = n_blocked = 0
    for row in read_csv_rows(pbp_csv):
        game_id = row.get("game_id")
        if not game_id:
            continue
        posteam, defteam = row.get("posteam"), row.get("defteam")

        if row.get("touchdown") == "1":
            yards = to_int(row.get("yards_gained"))
            return_yards = to_int(row.get("return_yards"))
            if row.get("pass_touchdown") == "1":
                length_bonus = tier_lookup(yards, TD_LENGTH_TIERS)
                add(row.get("passer_player_id"), game_id, posteam, "passing", length_bonus)
                add(row.get("receiver_player_id"), game_id, posteam, "receiving", length_bonus)
                n_td += 1
            elif row.get("rush_touchdown") == "1":
                add(row.get("rusher_player_id"), game_id, posteam, "rushing", tier_lookup(yards, TD_LENGTH_TIERS))
                n_td += 1
            elif row.get("return_touchdown") == "1":
                if row.get("interception") == "1":
                    # Defender: Defense group's per-yard length bonus (the
                    # flat 5-per-TD is already counted from def_tds).
                    add(row.get("td_player_id"), game_id, defteam, "turnover", (return_yards or 0) * 0.02)
                    # Passer: Passing group's flat + per-yard penalties for
                    # throwing a pick that got returned for a score.
                    add(row.get("passer_player_id"), game_id, posteam, "passing", -4)
                    add(row.get("passer_player_id"), game_id, posteam, "passing", (return_yards or 0) * -0.04)
                elif row.get("fumble_lost") == "1":
                    recovery_yards = to_int(row.get("fumble_recovery_1_yards"))
                    add(row.get("td_player_id"), game_id, defteam, "turnover", (recovery_yards or 0) * 0.02)
                    add(row.get("fumbled_1_player_id"), game_id, posteam, "fumbles_fouls", -6)
                    add(row.get("fumbled_1_player_id"), game_id, posteam, "fumbles_fouls", (recovery_yards or 0) * -0.04)
                elif row.get("play_type") == "punt":
                    add(row.get("td_player_id"), game_id, defteam, "returning", tier_lookup(return_yards, PUNT_RETURN_TD_TIERS))
                elif row.get("play_type") == "kickoff":
                    add(row.get("td_player_id"), game_id, defteam, "returning", tier_lookup(return_yards, KICKOFF_RETURN_TD_TIERS))
                n_td += 1

        if (
            row.get("field_goal_result") == "blocked"
            or row.get("extra_point_result") == "blocked"
            or row.get("punt_blocked") == "1"
        ):
            add(row.get("blocked_player_id"), game_id, defteam, "turnover", 4)
            n_blocked += 1

    for (player_id, game_id), cats in bonus_by_key.items():
        cur.execute(
            """INSERT INTO player_game_td_bonus (
                player_id, game_id, team, passing_bonus, rushing_bonus, receiving_bonus,
                turnover_bonus, fumbles_fouls_bonus, returning_bonus
            ) VALUES (?,?,?,?,?,?,?,?,?)""",
            (
                player_id, game_id, cats.get("team"),
                round(cats.get("passing", 0.0), 2), round(cats.get("rushing", 0.0), 2),
                round(cats.get("receiving", 0.0), 2), round(cats.get("turnover", 0.0), 2),
                round(cats.get("fumbles_fouls", 0.0), 2), round(cats.get("returning", 0.0), 2),
            ),
        )

    conn.commit()
    print(f"  season {season}: {len(bonus_by_key)} player-game bonus rows (from {n_td} TDs, {n_blocked} blocked kicks)")
    conn.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--season", type=int, action="append", dest="seasons")
    args = parser.parse_args()
    seasons = args.seasons or [2024, 2025, 2026]
    print("Building touchdown-length/blocked-kick bonuses from play-by-play data...")
    for season in seasons:
        build_td_bonuses(season)
    print("Done.")
