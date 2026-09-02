#!/usr/bin/env python3
"""
Downloads college football rosters from cfbfastR-data
(github.com/sportsdataverse/cfbfastR-data — the college-football sibling
project to nflverse, same community, same no-key plain-CSV-in-repo pattern)
for YEARS below, and resolves each row to this project's own NFL player_id
system wherever possible.

Scope: last ~10 seasons (YEARS), not the full 2004-present history cfbfastR
has — that covers every active NFL player's own college career (a rookie's
final college season is at most a few years old) without hauling in
decades of players who will never be looked up here.

Cross-referencing: cfbfastR's own athlete_id is a DIFFERENT id scheme than
this project's gsis_id (same situation build_draft_class.py already solved
for draft picks). Resolved here the identical way: normalize_name() against
data/nflverse/reference/players.csv's display_name — nflverse's master
player registry, which already carries a real gsis_id for any player who's
since made an NFL roster. A college player who never reaches the NFL simply
won't resolve (player_id stays NULL) — expected, not an error; college
data for them is still recorded, just not linkable to an NFL player page.

Writes to db/college.db:college_rosters (one row per athlete-season).

Usage:
    python3 data/college/build_college_rosters.py
"""
import csv
import sqlite3
import subprocess
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
PLAYERS_CSV = ROOT / "data" / "nflverse" / "reference" / "players.csv"
RAW_DIR = Path(__file__).resolve().parent / "raw" / "rosters"
DB_PATH = ROOT / "db" / "college.db"
SCHEMA_PATH = Path(__file__).resolve().parent / "schema.sql"
RELEASE_BASE = "https://raw.githubusercontent.com/sportsdataverse/cfbfastR-data/main"

YEARS = range(2016, 2027)


def normalize_name(name: str) -> str:
    """Same normalization build_draft_class.py uses, so a name that
    resolves there resolves here too."""
    name = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    for suffix in (" jr.", " jr", " sr.", " sr", " ii", " iii", " iv", " v"):
        if name.lower().endswith(suffix):
            name = name[: -len(suffix)]
    return "".join(c for c in name.lower() if c.isalnum())


def load_name_to_gsis() -> dict:
    by_name = {}
    with open(PLAYERS_CSV, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            name, gsis = row.get("display_name"), row.get("gsis_id")
            if name and gsis:
                by_name[normalize_name(name)] = gsis
    return by_name


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


def main():
    name_to_gsis = load_name_to_gsis()

    conn = sqlite3.connect(DB_PATH)
    conn.executescript(SCHEMA_PATH.read_text())
    cur = conn.cursor()
    cur.execute("DELETE FROM college_rosters")

    total = matched = 0
    for year in YEARS:
        csv_path = download(f"{RELEASE_BASE}/rosters/csv/cfb_rosters_{year}.csv",
                             RAW_DIR / f"cfb_rosters_{year}.csv")
        rows = []
        with open(csv_path, newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                first, last = row.get("first_name", ""), row.get("last_name", "")
                full_name = f"{first} {last}".strip()
                if not full_name or not row.get("athlete_id"):
                    continue
                player_id = name_to_gsis.get(normalize_name(full_name))
                rows.append((
                    row["athlete_id"], player_id, first, last, full_name,
                    row.get("team"), row.get("position"), row.get("jersey"),
                    row.get("year"), to_int(row.get("height")), to_int(row.get("weight")),
                    row.get("home_city"), row.get("home_state"), row.get("headshot_url"),
                    to_int(row.get("season")) or year,
                ))
        cur.executemany(
            "INSERT OR REPLACE INTO college_rosters VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", rows
        )
        n_matched = sum(1 for r in rows if r[1])
        print(f"  {year}: {len(rows)} roster rows, {n_matched} matched to a player_id")
        total += len(rows)
        matched += n_matched

    conn.commit()
    n = cur.execute("SELECT COUNT(*) FROM college_rosters").fetchone()[0]
    print(f"college_rosters: {n} rows across {len(list(YEARS))} seasons ({matched}/{total} rows matched to a player_id)")
    conn.close()
    print(f"Done -> {DB_PATH}")


if __name__ == "__main__":
    main()
