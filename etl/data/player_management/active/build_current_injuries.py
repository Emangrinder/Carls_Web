#!/usr/bin/env python3
"""
Snapshot of the CURRENT injury report — who's banged up going into this
weekend's games. Same underlying nflverse injuries source as
data/player_management/history/injuries/build_injuries.py, but this script
keeps only the latest available week and fully replaces the table each run,
rather than accumulating. Re-downloads fresh every time on purpose (no
caching) — "current" is the whole point.

For trend/deterioration analysis across weeks and seasons, use
db/player_management_history.db's injuries table instead — that's the full
log this is deliberately NOT.

Usage:
    python3 data/player_management/active/build_current_injuries.py --season 2025
"""
import argparse
import csv
import datetime
import sqlite3
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent.parent
RAW_DIR = ROOT / "data" / "player_management" / "active" / "raw"
DB_PATH = ROOT / "db" / "player_management_active.db"
SCHEMA_PATH = Path(__file__).resolve().parent / "schema.sql"
RELEASE_BASE = "https://github.com/nflverse/nflverse-data/releases/download"


def download_fresh(url: str, dest: Path) -> Path:
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

    csv_path = download_fresh(
        f"{RELEASE_BASE}/injuries/injuries_{season}.csv",
        RAW_DIR / f"injuries_{season}.csv",
    )

    # Scope to REG weeks 1-18, same reasoning as build_active_roster.py — the raw
    # source also has playoff weeks, whose "latest week" would only cover 2 teams.
    all_rows = list(csv.DictReader(open(csv_path, newline="", encoding="utf-8")))
    rows = [r for r in all_rows if r.get("game_type") == "REG" and to_int(r.get("week")) is not None
            and 1 <= to_int(r["week"]) <= 18]
    weeks = [to_int(r["week"]) for r in rows]
    if not weeks:
        raise SystemExit(f"no REG week 1-18 data found in {csv_path}")
    latest_week = max(weeks)
    latest_rows = [r for r in rows if to_int(r["week"]) == latest_week]
    print(f"  {len(all_rows)} total rows in source, {len(rows)} in REG weeks 1-18, "
          f"{len(latest_rows)} in latest such week ({latest_week})")

    conn = sqlite3.connect(DB_PATH)
    conn.executescript(SCHEMA_PATH.read_text())
    cur = conn.cursor()
    cur.execute("DELETE FROM current_injury_report")

    as_of = datetime.datetime.now(datetime.timezone.utc).isoformat()
    insert_rows = [
        (
            r.get("gsis_id"), r.get("team"), r.get("position"), r.get("full_name"),
            r.get("report_primary_injury") or None, r.get("report_secondary_injury") or None,
            r.get("report_status") or None, r.get("practice_status") or None,
            season, latest_week, as_of,
        )
        for r in latest_rows if r.get("gsis_id")
    ]
    cur.executemany("INSERT OR REPLACE INTO current_injury_report VALUES (?,?,?,?,?,?,?,?,?,?,?)", insert_rows)
    conn.commit()

    n_out = cur.execute("SELECT COUNT(*) FROM current_injury_report WHERE report_status='Out'").fetchone()[0]
    n_total = cur.execute("SELECT COUNT(*) FROM current_injury_report").fetchone()[0]
    print(f"current_injury_report: {n_total} players on report ({n_out} 'Out'), season {season} week {latest_week}")
    conn.close()
    print(f"Done -> {DB_PATH}")


if __name__ == "__main__":
    main()
