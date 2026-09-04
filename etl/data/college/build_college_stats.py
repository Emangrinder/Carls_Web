#!/usr/bin/env python3
"""
Aggregates cfbfastR-data's play-by-play-level player_stats export
(github.com/sportsdataverse/cfbfastR-data — one row per PLAY, with a
separate {role}_player_id/{role}_player/{role}_yds column TRIPLE per stat
type, e.g. rush_player_id/rush_player/rush_yds) into one row per
(athlete, season) — the box-score-style season totals a player page can
actually show, since nothing upstream provides that directly.

Touchdown attribution needs special handling: the source's own
touchdown_stat column is just a flag ("1"/"NA"), not a type — a passing
TD's touchdown_player is the PASSER (matching NFL convention), not the
receiver, so a receiving TD has to be inferred from reception_player being
populated on the same scoring row, not from touchdown_player_id matching
reception_player_id (checked real rows to confirm this before writing the
logic below — a passing-TD row has touchdown_player_id == the passer's id,
completion_player_id == the same passer, AND reception_player_id == the
receiver, all on one row).

No raw tackle counts exist in this source at all — def_* stats here are
limited to what it actually tracks: interceptions, sacks, forced fumbles,
fumble recoveries, and pass breakups.

player_id resolution: JOINS on athlete_id against db/college.db's own
college_rosters table (build_college_rosters.py must run first) rather than
re-doing name-matching here — athlete_id is a precise, non-fuzzy key shared
between cfbfastR's rosters and player_stats exports, so reusing the
crosswalk build_college_rosters.py already resolved keeps both tables
consistent instead of risking two independent name-matching passes
disagreeing with each other.

Usage:
    python3 data/college/build_college_stats.py
"""
import sqlite3
import subprocess
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent.parent
RAW_DIR = Path(__file__).resolve().parent / "raw" / "player_stats"
DB_PATH = ROOT / "db" / "college.db"
SCHEMA_PATH = Path(__file__).resolve().parent / "schema.sql"
RELEASE_BASE = "https://raw.githubusercontent.com/sportsdataverse/cfbfastR-data/main"

YEARS = range(2016, 2027)

# (role prefix, aggregate-count column, aggregate-yards column or None)
COUNT_ROLES = {
    "rush": "rush_att", "target": "targets", "reception": "receptions",
    "completion": "pass_comp", "incompletion": None, "interception_thrown": None,
    "interception": "def_int", "sack": "def_sacks", "fumble_forced": "def_ff",
    "fumble_recovered": "def_fr", "pass_breakup": "def_pbu",
    "field_goal_made": "fg_made", "field_goal_attempt": "fg_att",
    "field_goal_missed": "fg_missed", "field_goal_blocked": "fg_blocked",
}
YARDS_ROLES = {"rush": "rush_yds", "reception": "rec_yds", "completion": "pass_yds"}


def download(url: str, dest: Path) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    print(f"  downloading {url}")
    subprocess.run(["curl", "-sL", "-o", str(dest), url], check=True)
    return dest


def load_athlete_crosswalk(conn) -> dict:
    rows = conn.execute("SELECT DISTINCT athlete_id, player_id FROM college_rosters WHERE player_id IS NOT NULL")
    return dict(rows.fetchall())


def load_team_by_athlete_season(conn) -> dict:
    """(athlete_id, season) -> team, from college_rosters — NOT derivable
    from the play-by-play data itself: its own "team"/"opponent" columns
    represent whichever side had the ball on that specific play, which
    flips possession-by-possession within a game, so a defender's rows are
    a real mix of both teams' "team" values depending on who was driving
    (checked real rows to confirm: two Florida State pass-rushers and one
    Alabama safety all showed team="Alabama" on the same Alabama-vs-FSU
    game's sack rows). college_rosters' own team assignment doesn't have
    that problem."""
    rows = conn.execute("SELECT athlete_id, season, team FROM college_rosters")
    return {(aid, season): team for aid, season, team in rows.fetchall()}


def clean_id(athlete_id) -> str | None:
    """pandas loads these id columns as float64 (NaN-safe), so a raw id
    like 4871081 comes through as 4871081.0 — str()'d directly that's
    "4871081.0", which would never match college_rosters.athlete_id's
    plain "4871081" (loaded via csv.DictReader, no float round-trip).
    Round-tripping through int() here is what makes the two agree."""
    if athlete_id is None or pd.isna(athlete_id):
        return None
    return str(int(athlete_id))


def aggregate_year(df: pd.DataFrame, year: int) -> pd.DataFrame:
    names = {}  # athlete_id -> a name seen for them
    per_athlete = {}  # athlete_id -> dict of stat totals
    games = {}  # athlete_id -> set of game_id

    def bump(athlete_id, name, field, amount=1):
        athlete_id = clean_id(athlete_id)
        if athlete_id is None:
            return
        if name and not pd.isna(name):
            names.setdefault(athlete_id, name)
        d = per_athlete.setdefault(athlete_id, {})
        d[field] = d.get(field, 0) + amount

    def touch_game(athlete_id, game_id):
        athlete_id = clean_id(athlete_id)
        if athlete_id is None:
            return
        games.setdefault(athlete_id, set()).add(game_id)

    for role, count_field in COUNT_ROLES.items():
        id_col, name_col = f"{role}_player_id", f"{role}_player"
        if id_col not in df.columns:
            continue
        sub = df[df[id_col].notna()]
        for athlete_id, name, game_id in zip(sub[id_col], sub[name_col], sub["game_id"]):
            touch_game(athlete_id, game_id)
            if count_field:
                bump(athlete_id, name, count_field)
            # count_field is None for incompletion/interception_thrown — those
            # two are aggregated by their own dedicated loops below (pass_att,
            # pass_int), which also register the name via bump(); nothing
            # further needed here beyond the touch_game() above.

    for role, yards_field in YARDS_ROLES.items():
        id_col, name_col, yds_col = f"{role}_player_id", f"{role}_player", f"{role}_yds"
        if id_col not in df.columns:
            continue
        sub = df[df[id_col].notna()]
        for athlete_id, name, yds in zip(sub[id_col], sub[name_col], sub[yds_col]):
            bump(athlete_id, name, yards_field, int(yds) if pd.notna(yds) else 0)

    # pass_att = completions + incompletions (no separate "attempt" role in the source)
    if "incompletion_player_id" in df.columns:
        sub = df[df["incompletion_player_id"].notna()]
        for athlete_id, name, game_id in zip(sub["incompletion_player_id"], sub["incompletion_player"], sub["game_id"]):
            touch_game(athlete_id, game_id)
            bump(athlete_id, name, "pass_att")
    for athlete_id, d in per_athlete.items():
        d["pass_att"] = d.get("pass_att", 0) + d.get("pass_comp", 0)

    # targets: target_player_id is NOT a reliable "who was thrown to on every
    # attempt" column in this source -- checked real rows to confirm it's
    # never populated on a completion (reception_player_id covers that case
    # instead) and is only populated on a minority of incompletions (~20% in
    # a sample season), leaving most incomplete-pass targets unidentified.
    # Summing target_player_id alone (as the COUNT_ROLES loop above does)
    # therefore undercounts targets so badly it can land BELOW receptions,
    # which is a receiver stat-line that can't exist. Same fix shape as
    # pass_att above: targets = whatever target_player_id captured (sparse
    # incompletion targets) + receptions (every completion is definitionally
    # a target), guaranteeing targets >= receptions. Still an undercount
    # against true targets, since most untargeted incompletions have no
    # identifiable receiver in this source at all -- there's no fixing that
    # without better upstream charting.
    for athlete_id, d in per_athlete.items():
        d["targets"] = d.get("targets", 0) + d.get("receptions", 0)

    # pass_int (thrown, an offensive negative) uses a different role name
    # than def_int (a defensive takeaway) — same underlying play, two sides.
    if "interception_thrown_player_id" in df.columns:
        sub = df[df["interception_thrown_player_id"].notna()]
        for athlete_id, name, game_id in zip(sub["interception_thrown_player_id"], sub["interception_thrown_player"], sub["game_id"]):
            touch_game(athlete_id, game_id)
            bump(athlete_id, name, "pass_int")

    # Touchdowns: co-occurrence on the same scoring row, not touchdown_player_id
    # itself (see this file's docstring for why).
    if "touchdown_stat" in df.columns:
        # pandas loads this NaN/"1"-only column as float64 (1.0), not a
        # string "1" — same class of bug as the id columns above.
        td_rows = df[df["touchdown_stat"] == 1]
        if "rush_player_id" in td_rows.columns:
            sub = td_rows[td_rows["rush_player_id"].notna()]
            for athlete_id, name in zip(sub["rush_player_id"], sub["rush_player"]):
                bump(athlete_id, name, "rush_td")
        if "reception_player_id" in td_rows.columns:
            sub = td_rows[td_rows["reception_player_id"].notna()]
            for athlete_id, name in zip(sub["reception_player_id"], sub["reception_player"]):
                bump(athlete_id, name, "rec_td")
        if "completion_player_id" in td_rows.columns:
            sub = td_rows[td_rows["completion_player_id"].notna()]
            for athlete_id, name in zip(sub["completion_player_id"], sub["completion_player"]):
                bump(athlete_id, name, "pass_td")

    fields = ["rush_att", "rush_yds", "rush_td", "targets", "receptions", "rec_yds", "rec_td",
              "pass_comp", "pass_att", "pass_yds", "pass_td", "pass_int",
              "def_int", "def_sacks", "def_ff", "def_fr", "def_pbu",
              "fg_made", "fg_att", "fg_missed", "fg_blocked"]
    out_rows = []
    for athlete_id, d in per_athlete.items():
        row = {"athlete_id": athlete_id, "player_name": names.get(athlete_id), "season": year,
               "games": len(games.get(athlete_id, set()))}
        for f in fields:
            row[f] = d.get(f, 0)
        out_rows.append(row)
    return pd.DataFrame(out_rows)


def main():
    conn = sqlite3.connect(DB_PATH)
    conn.executescript(SCHEMA_PATH.read_text())
    crosswalk = load_athlete_crosswalk(conn)
    team_by_athlete_season = load_team_by_athlete_season(conn)
    cur = conn.cursor()
    cur.execute("DELETE FROM college_player_season_stats")

    cols = ["athlete_id", "player_id", "player_name", "team", "season", "games",
            "rush_att", "rush_yds", "rush_td", "targets", "receptions", "rec_yds", "rec_td",
            "pass_comp", "pass_att", "pass_yds", "pass_td", "pass_int",
            "def_int", "def_sacks", "def_ff", "def_fr", "def_pbu",
            "fg_made", "fg_att", "fg_missed", "fg_blocked"]

    total = matched = 0
    for year in YEARS:
        csv_path = download(f"{RELEASE_BASE}/player_stats/csv/player_stats_{year}.csv",
                             RAW_DIR / f"player_stats_{year}.csv")
        df = pd.read_csv(csv_path, low_memory=False)

        agg = aggregate_year(df, year)
        if agg.empty:
            print(f"  {year}: no player rows")
            continue
        agg["player_id"] = agg["athlete_id"].map(crosswalk)
        agg["team"] = agg["athlete_id"].map(lambda aid: team_by_athlete_season.get((aid, year)))

        rows = [tuple(r.get(c) for c in cols) for r in agg.to_dict("records")]
        cur.executemany(
            f"INSERT OR REPLACE INTO college_player_season_stats VALUES ({','.join('?' for _ in cols)})", rows
        )
        n_matched = int(agg["player_id"].notna().sum())
        print(f"  {year}: {len(agg)} player-season rows, {n_matched} matched to a player_id")
        total += len(agg)
        matched += n_matched

    conn.commit()
    n = cur.execute("SELECT COUNT(*) FROM college_player_season_stats").fetchone()[0]
    print(f"college_player_season_stats: {n} rows ({matched}/{total} matched to a player_id)")
    conn.close()
    print(f"Done -> {DB_PATH}")


if __name__ == "__main__":
    main()
