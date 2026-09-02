#!/usr/bin/env python3
"""
Loads nflverse's weekly injury report data (real designations — Out/Doubtful/
Questionable/practice status — not the games-delta proxy used elsewhere in
this project before this existed). Source covers 2009+; this project scopes
to whatever season you pass, matching db/nfl_<season>.db's coverage.

player_id here is gsis_id, same scheme as everywhere else in this project —
no crosswalk needed, unlike snap_counts/trades which use PFR ids.

Writes to db/player_management_history.db (NOT db/nfl_<season>.db, and NOT
db/player_management_active.db — this is the full accumulating log, for
trend/deterioration analysis across weeks and seasons. See
data/player_management/active/build_current_injuries.py for "who's banged up
going into this weekend," which is a filtered view of this same source data,
not a separate download).

Usage:
    python3 data/player_management/history/injuries/build_injuries.py --season 2025
"""
import argparse
import csv
import sqlite3
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent.parent.parent
RAW_DIR = ROOT / "data" / "player_management" / "history" / "injuries" / "raw"
DB_PATH = ROOT / "db" / "player_management_history.db"
SCHEMA_PATH = ROOT / "data" / "player_management" / "history" / "schema.sql"
RELEASE_BASE = "https://github.com/nflverse/nflverse-data/releases/download"


def download(url: str, dest: Path) -> Path:
    if dest.exists():
        return dest
    dest.parent.mkdir(parents=True, exist_ok=True)
    print(f"  downloading {url}")
    subprocess.run(["curl", "-sL", "-o", str(dest), url], check=True)
    return dest


def to_int(v):
    try:
        return int(v) if v not in (None, "") else None
    except ValueError:
        return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--season", type=int, default=2025)
    args = parser.parse_args()
    season = args.season

    csv_path = download(
        f"{RELEASE_BASE}/injuries/injuries_{season}.csv",
        RAW_DIR / f"injuries_{season}.csv",
    )

    conn = sqlite3.connect(DB_PATH)
    conn.executescript(SCHEMA_PATH.read_text())
    cur = conn.cursor()
    cur.execute("DELETE FROM injuries WHERE season = ?", (season,))

    # Column set drifts slightly year to year (e.g. 2024 has no season_type but adds
    # date_modified; 2025 has season_type but not date_modified) - use .get() throughout
    # rather than direct indexing so a missing column becomes NULL, not a crash.
    rows = []
    with open(csv_path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            rows.append((
                to_int(row.get("season")), to_int(row.get("week")), row.get("season_type"), row.get("game_type"),
                row.get("team"), row.get("gsis_id"), row.get("position"), row.get("full_name"),
                row.get("report_primary_injury") or None, row.get("report_secondary_injury") or None,
                row.get("report_status") or None,
                row.get("practice_primary_injury") or None, row.get("practice_secondary_injury") or None,
                row.get("practice_status") or None,
            ))

    cur.executemany("INSERT OR REPLACE INTO injuries VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)", rows)
    conn.commit()

    n = cur.execute("SELECT COUNT(*) FROM injuries WHERE season = ?", (season,)).fetchone()[0]
    n_out = cur.execute(
        "SELECT COUNT(*) FROM injuries WHERE season = ? AND report_status = 'Out'", (season,)
    ).fetchone()[0]
    print(f"injuries (season {season}): {n} rows, {n_out} tagged 'Out'")
    conn.close()
    print(f"Done -> {DB_PATH}")


if __name__ == "__main__":
    main()
