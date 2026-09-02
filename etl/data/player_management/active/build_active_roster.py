#!/usr/bin/env python3
"""
Snapshot of each team's CURRENT roster: source is nflverse's weekly_rosters
release, which has a real `status` field (ACT/INA/CUT/RES/DEV/RET/TRD/TRC/
EXE — nflverse's own codes, not inferred from snap counts or trade history).

This is a SNAPSHOT, not a log: every run fully replaces active_roster with
whatever the latest available week says, rather than accumulating rows
across weeks. For roster history over time, that's what trades in
db/player_management_history.db is for (the event log behind roster
changes) — this table only ever answers "who's on this team right now."

Usage:
    python3 data/player_management/active/build_active_roster.py --season 2025
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
    """Always re-downloads — this is a 'what's current' feed, caching would defeat the point."""
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
        f"{RELEASE_BASE}/weekly_rosters/roster_weekly_{season}.csv",
        RAW_DIR / f"roster_weekly_{season}.csv",
    )

    # Scope to REG weeks 1-18, matching every other dataset in this project (the raw
    # source also has WC/DIV/CON/SB rows, whose "latest week" is playoff week 22 with
    # only the 2 Super Bowl teams — not a real league-wide "current roster" snapshot).
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
    cur.execute("DELETE FROM active_roster")

    as_of = datetime.datetime.now(datetime.timezone.utc).isoformat()
    insert_rows = [
        (
            r["gsis_id"], r["team"], r["position"], r["depth_chart_position"], r["status"],
            r["status_description_abbr"], to_int(r["jersey_number"]), r["full_name"],
            season, latest_week, as_of,
        )
        for r in latest_rows if r["gsis_id"]
    ]
    cur.executemany("INSERT OR REPLACE INTO active_roster VALUES (?,?,?,?,?,?,?,?,?,?,?)", insert_rows)
    conn.commit()

    n_act = cur.execute("SELECT COUNT(*) FROM active_roster WHERE status='ACT'").fetchone()[0]
    n_total = cur.execute("SELECT COUNT(*) FROM active_roster").fetchone()[0]
    print(f"active_roster: {n_total} players ({n_act} status=ACT), snapshot of season {season} week {latest_week}")
    conn.close()
    print(f"Done -> {DB_PATH}")


if __name__ == "__main__":
    main()
