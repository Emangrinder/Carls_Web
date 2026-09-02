#!/usr/bin/env python3
"""
Loads nflverse's depth chart feed — ESPN-sourced, but polled and timestamped
repeatedly by nflverse itself (221 distinct snapshots for 2025 alone, not
just a single current state). One download populates BOTH databases in one
run, since re-downloading a ~550k-row file twice would be wasteful:

  db/player_management_history.db : depth_chart_history — every snapshot kept
  db/player_management_active.db  : depth_chart_ranks — latest snapshot only

This is one vendor (nflverse/ESPN) of the eventual multi-vendor picture
(ESPN + CBS + team sites, reliability-weighted) described in
data/player_management/depth_charts/PLAN.md. That plan is NOT implemented
yet — this script only loads the one source we can already reach without
writing any new site-reading code (nflverse ships it as a structured CSV,
same as everything else in data/nflverse/).

Usage:
    python3 data/player_management/history/depth_charts/build_depth_charts.py --season 2025
"""
import argparse
import csv
import subprocess
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent.parent.parent
RAW_DIR = ROOT / "data" / "player_management" / "history" / "depth_charts" / "raw"
HISTORY_DB = ROOT / "db" / "player_management_history.db"
ACTIVE_DB = ROOT / "db" / "player_management_active.db"
HISTORY_SCHEMA = ROOT / "data" / "player_management" / "history" / "schema.sql"
ACTIVE_SCHEMA = ROOT / "data" / "player_management" / "active" / "schema.sql"
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
        f"{RELEASE_BASE}/depth_charts/depth_charts_{season}.csv",
        RAW_DIR / f"depth_charts_{season}.csv",
    )

    rows = list(csv.DictReader(open(csv_path, newline="", encoding="utf-8")))
    dts = sorted({r["dt"] for r in rows})
    latest_dt = dts[-1]
    print(f"  {len(rows)} rows, {len(dts)} distinct snapshots, latest = {latest_dt}")

    # ---- history: every snapshot ----
    hconn = sqlite3.connect(HISTORY_DB)
    hconn.executescript(HISTORY_SCHEMA.read_text())
    hcur = hconn.cursor()
    hcur.execute("DELETE FROM depth_chart_history WHERE source = 'nflverse_espn'")
    hcur.executemany(
        "INSERT OR REPLACE INTO depth_chart_history VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        [(r["dt"], r["team"], r["gsis_id"] or None, r["player_name"], r["espn_id"] or None,
          r["pos_grp"], r["pos_name"], r["pos_abb"], r["pos_slot"], to_int(r["pos_rank"]), "nflverse_espn")
         for r in rows],
    )
    hconn.commit()
    n_hist = hcur.execute("SELECT COUNT(*) FROM depth_chart_history WHERE source='nflverse_espn'").fetchone()[0]
    print(f"depth_chart_history: {n_hist} rows across {len(dts)} snapshots")
    hconn.close()

    # ---- active: latest snapshot only ----
    latest_rows = [r for r in rows if r["dt"] == latest_dt]
    aconn = sqlite3.connect(ACTIVE_DB)
    aconn.executescript(ACTIVE_SCHEMA.read_text())
    acur = aconn.cursor()
    acur.execute("DELETE FROM depth_chart_ranks WHERE source = 'nflverse_espn'")
    acur.executemany(
        "INSERT OR REPLACE INTO depth_chart_ranks VALUES (?,?,?,?,?,?,?,?,?,?)",
        [(r["team"], r["gsis_id"] or None, r["player_name"], r["pos_grp"], r["pos_name"],
          r["pos_abb"], r["pos_slot"], to_int(r["pos_rank"]), "nflverse_espn", latest_dt)
         for r in latest_rows],
    )
    aconn.commit()
    n_active = acur.execute("SELECT COUNT(*) FROM depth_chart_ranks WHERE source='nflverse_espn'").fetchone()[0]
    print(f"depth_chart_ranks: {n_active} rows (snapshot as of {latest_dt})")
    aconn.close()
    print(f"Done -> {HISTORY_DB} and {ACTIVE_DB}")


if __name__ == "__main__":
    main()
