#!/usr/bin/env python3
"""
Current head coach / OC / DC per team, plus the year each was hired.

Unlike everything else in this folder, this is NOT re-scraped every run --
coaching staff changes maybe a dozen times league-wide per year, so it's a
manually curated JSON file (data/reference/coaches_<year>.json) updated
occasionally by hand, not an automated feed. Source data was cross-checked
against Wikipedia's "List of current NFL head coaches" for the 2026 season's
unusually large coaching carousel before being trusted.

Usage:
    python3 data/player_management/active/build_coaching_staff.py --season 2026
"""
import argparse
import json
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent.parent
DB_PATH = ROOT / "db" / "player_management_active.db"
SCHEMA_PATH = Path(__file__).resolve().parent / "schema.sql"

# The source JSON's own key names per role -> our (role) label.
ROLE_KEYS = {
    "hc_wikipedia": "HC",
    "oc": "OC",
    "dc": "DC",
}

# The source JSON uses "LAR" for the Rams; every other table in this project
# uses "LA" (see app/src/constants.js's CURRENT_TEAMS comment).
TEAM_ABBR_REMAP = {"LAR": "LA"}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--season", type=int, default=2026)
    args = parser.parse_args()

    json_path = ROOT / "data" / "reference" / f"coaches_{args.season}.json"
    data = json.loads(json_path.read_text())

    conn = sqlite3.connect(DB_PATH)
    conn.executescript(SCHEMA_PATH.read_text())
    cur = conn.cursor()
    cur.execute("DELETE FROM current_coaching_staff")

    rows = []
    for raw_team, roles in data.items():
        team = TEAM_ABBR_REMAP.get(raw_team, raw_team)
        for json_key, role in ROLE_KEYS.items():
            entry = roles.get(json_key)
            if not entry or not entry.get("name"):
                continue
            since = entry.get("since")
            rows.append((team, role, entry["name"], int(since) if since else None))

    cur.executemany(
        "INSERT OR REPLACE INTO current_coaching_staff VALUES (?,?,?,?)", rows
    )
    conn.commit()
    print(f"current_coaching_staff: {len(rows)} rows across {len(data)} teams")
    conn.close()
    print(f"Done -> {DB_PATH}")


if __name__ == "__main__":
    main()
