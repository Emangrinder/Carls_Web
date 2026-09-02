#!/usr/bin/env python3
"""
Loads nflverse's trades ledger (all-time, one file, actively maintained —
includes offseason trades ahead of the upcoming season). One row per ASSET
moved (a player or a draft pick), not per trade — a single trade_id can span
several rows, each with a gave_team and a received_team for that one asset.

Players are identified by pfr_id in the source; crosswalked to our gsis-based
player_id via data/nflverse/reference/players.csv's own pfr_id column, same
mechanism used for snap_counts elsewhere in this project. Draft-pick rows
have no pfr_id and so no player_id — that's expected, not a gap.

Writes to db/player_management_history.db (the accumulating log), same as
build_injuries.py. Trades matter here mainly as the EVENT LOG behind roster
changes — data/player_management/active/build_active_roster.py is what
actually tells you a player's current team; this is "how did it get that
way," not itself a live roster feed.

Usage:
    python3 data/player_management/history/trades/build_trades.py
"""
import csv
import sqlite3
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent.parent.parent
RAW_DIR = ROOT / "data" / "player_management" / "history" / "trades" / "raw"
REFERENCE_DIR = ROOT / "data" / "nflverse" / "reference"
DB_PATH = ROOT / "db" / "player_management_history.db"
SCHEMA_PATH = ROOT / "data" / "player_management" / "history" / "schema.sql"
RELEASE_BASE = "https://github.com/nflverse/nflverse-data/releases/download"


def download(url: str, dest: Path) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    print(f"  downloading {url}")
    subprocess.run(["curl", "-sL", "-o", str(dest), url], check=True)
    return dest


def to_int(v):
    try:
        return int(v) if v not in (None, "") else None
    except ValueError:
        return None


def pfr_to_gsis_crosswalk():
    crosswalk = {}
    with open(REFERENCE_DIR / "players.csv", newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if row.get("pfr_id"):
                crosswalk[row["pfr_id"]] = row["gsis_id"]
    return crosswalk


def main():
    # trades.csv is a single all-time file, always re-downloaded (not cached) since
    # it's actively updated with new trades, unlike the season-locked play-stats files
    csv_path = download(f"{RELEASE_BASE}/trades/trades.csv", RAW_DIR / "trades.csv")

    crosswalk = pfr_to_gsis_crosswalk()
    conn = sqlite3.connect(DB_PATH)
    conn.executescript(SCHEMA_PATH.read_text())
    cur = conn.cursor()
    cur.execute("DELETE FROM trades")

    rows, n_player_rows, n_matched = [], 0, 0
    with open(csv_path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            pfr_id = row["pfr_id"] or None
            player_id = None
            if pfr_id:
                n_player_rows += 1
                player_id = crosswalk.get(pfr_id)
                if player_id:
                    n_matched += 1
            rows.append((
                to_int(row["trade_id"]), to_int(row["season"]), row["trade_date"],
                row["gave"], row["received"],
                to_int(row["pick_season"]), to_int(row["pick_round"]), to_int(row["pick_number"]),
                to_int(row["conditional"]), pfr_id, row["pfr_name"] or None, player_id,
            ))

    cur.executemany("INSERT OR REPLACE INTO trades VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", rows)
    conn.commit()

    print(f"trades: {len(rows)} asset-rows loaded")
    print(f"  {n_player_rows} were players, {n_matched} matched to a player_id ({n_player_rows - n_matched} unmatched)")
    conn.close()
    print(f"Done -> {DB_PATH}")


if __name__ == "__main__":
    main()
