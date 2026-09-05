#!/usr/bin/env python3
"""Computes per-game fantasy points for every player, applying the Fantasy
Rules scoring formulas universally -- whoever actually recorded a stat
gets its points, not just the position the rule group was nominally drawn
up around (a TE who threw a pass scores under `passing` same as a QB).
Source formulas: app/src/fantasyRulesData.js.

Run against an already-built season DB (etl/db/nfl_<season>.db), since it
reads player_offense_stats / player_defense_stats /
player_special_teams_stats, which build_db.py populates.

KNOWN LIMITATIONS -- data we don't have, so these specific sub-bonuses are
left out rather than guessed:
  - Touchdown LENGTH tiers (passing/rushing/receiving/defensive/return TDs
    all have per-length bonus tiers) -- nflverse's per-game aggregates
    only have TD *counts*, not individual play yardage.
  - Interception- or fumble-lost-returned-for-a-TD, credited against the
    passer/fumbler -- needs cross-player play-level attribution the
    aggregates don't carry.
  - Blocked field goals/punts/extra points credited to the individual
    defender who made the block -- not a column in our defense stats.
  - Return-TD length tiers, same reason as touchdown length above.
  - Coach / Offensive Coordinator (ST) / Defensive Coordinator (DEF) --
    these are team- and coach-level, not per-player, and need a
    different join (team_game_stats, and a coach-to-team mapping we
    don't track results for) -- a separate follow-up, not attempted here.
Every OTHER rule in the Passing/Rushing/Receiving/Blocking Bonus/Fumbles
and Fouls/Defense/Kicking/Punting/Returning groups is computed in full.
"""
import argparse
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
DB_DIR = ROOT / "db"


def to_num(v):
    return v if v is not None else 0


def fg_points_from_list(list_str, made: bool):
    """Exact per-kick tier lookup using the semicolon-separated distance
    list, since nflverse's own fg_made_*/fg_missed_* buckets don't split
    finely enough to match the rules' tiers (e.g. 40-44 vs 45-49)."""
    if not list_str:
        return 0.0
    total = 0.0
    for part in list_str.split(";"):
        part = part.strip()
        if not part:
            continue
        try:
            dist = float(part)
        except ValueError:
            continue
        if made:
            if dist < 30:
                total += 2
            elif dist < 40:
                total += 3
            elif dist < 45:
                total += 4
            elif dist < 50:
                total += 4.5
            elif dist < 55:
                total += 5
            elif dist < 60:
                total += 5.5
            elif dist < 65:
                total += 6
            elif dist < 70:
                total += 7
            elif dist < 75:
                total += 8
            elif dist < 80:
                total += 9
            else:
                total += 10
        else:
            if dist < 30:
                total += -3
            elif dist < 50:
                total += -2
            else:
                total += -1
    return total


def punt_yards_bucket(yards):
    """"Punt Yards" is a flat bonus for which bracket the total lands in,
    not a per-yard rate."""
    if yards is None:
        return 0.0
    if yards < 0:
        return -5
    if yards <= 100:
        return 1
    if yards <= 200:
        return 2
    if yards <= 300:
        return 3
    if yards <= 400:
        return 4
    if yards <= 500:
        return 6
    if yards <= 600:
        return 10
    return 15


def punt_avg_points(avg):
    """0pts at 0, +0.05/yd up to 39.9, then 2pts at the 40 threshold plus
    +0.04 per additional 0.1 yard beyond it."""
    if avg is None or avg <= 0:
        return 0.0
    if avg < 40:
        return avg * 0.05
    return 2 + (avg - 40) * 10 * 0.04


def compute_passing(r):
    completions = to_num(r["completions"])
    attempts = to_num(r["attempts"])
    return (
        to_num(r["passing_tds"]) * 2
        + to_num(r["passing_yards"]) * 0.05
        + completions * 0.3
        + (attempts - completions) * -0.4
        + to_num(r["passing_interceptions"]) * -4
        # sack_yards_lost is stored as a negative number (nflverse's usual
        # "yards lost" convention) -- multiplying by the rule's own -0.2
        # coefficient would flip a real yardage loss into a point BONUS,
        # backwards from the rule's intent (being sacked costs points).
        + to_num(r["sack_yards_lost"]) * 0.2
        + to_num(r["passing_20"]) * 2
        + to_num(r["passing_40"]) * 3
        + to_num(r["passing_2pt_conversions"]) * 2
    )


def compute_rushing(r):
    return (
        to_num(r["rushing_tds"]) * 2
        + to_num(r["rushing_yards"]) * 0.1
        + to_num(r["rushing_20"]) * 2
        + to_num(r["rushing_40"]) * 3
        + to_num(r["rushing_2pt_conversions"]) * 2
    )


def compute_receiving(r):
    return (
        to_num(r["receiving_tds"]) * 2
        + to_num(r["receiving_yards"]) * 0.1
        + to_num(r["receptions"]) * 1
        + to_num(r["targets"]) * -0.5
        + to_num(r["receiving_20"]) * 1
        + to_num(r["receiving_40"]) * 2
        + to_num(r["receiving_2pt_conversions"]) * 2
    )


def compute_blocking_bonus(r):
    total = 0.0
    completions = to_num(r["completions"])
    carries = to_num(r["carries"])
    receptions = to_num(r["receptions"])
    if completions:
        total += (to_num(r["passing_yards"]) / completions) * 0.1
    if carries:
        total += (to_num(r["rushing_yards"]) / carries) * 1
    total += carries * 0.5
    if receptions:
        total += (to_num(r["receiving_yards"]) / receptions) * 0.5
    return total


def compute_offense_fumbles(r):
    fumbles = to_num(r["rushing_fumbles"]) + to_num(r["receiving_fumbles"]) + to_num(r["sack_fumbles"])
    lost = to_num(r["rushing_fumbles_lost"]) + to_num(r["receiving_fumbles_lost"]) + to_num(r["sack_fumbles_lost"])
    return fumbles * -2 + lost * -3 + to_num(r["penalty_yards"]) * -0.2


def compute_defense_fumbles(r):
    return to_num(r["fumble_recovery_own"]) * 2 + to_num(r["fumble_recovery_yards_own"]) * 0.1 + to_num(r["penalty_yards"]) * -0.2


def compute_pressure(r):
    return (
        to_num(r["def_sacks"]) * 2
        + to_num(r["def_sack_yards"]) * 0.3
        + to_num(r["def_tackles_for_loss"]) * 3
        + to_num(r["def_qb_hits"]) * 2
    )


def compute_coverage(r):
    return (
        to_num(r["def_tackles_solo"]) * 1.2
        + to_num(r["def_tackles_with_assist"]) * 0.6
        + to_num(r["def_pass_defended"]) * 4
    )


def compute_turnover(r):
    return (
        to_num(r["def_fumbles_forced"]) * 3
        + to_num(r["fumble_recovery_opp"]) * 3
        + to_num(r["fumble_recovery_yards_opp"]) * 0.3
        + to_num(r["def_interceptions"]) * 5
        + to_num(r["def_interception_yards"]) * 0.3
        + to_num(r["def_safeties"]) * 2
        + to_num(r["def_tds"]) * 5
    )


def compute_kicking(r):
    return (
        fg_points_from_list(r["fg_made_list"], made=True)
        + fg_points_from_list(r["fg_missed_list"], made=False)
        + to_num(r["fg_blocked"]) * -2
        + to_num(r["pat_made"]) * 0.5
        + to_num(r["pat_missed"]) * -4
        + to_num(r["pat_blocked"]) * -2
    )


def compute_punting(r):
    pt_att = to_num(r["pt_att"])
    pt_yards = to_num(r["pt_yards"])
    avg = (pt_yards / pt_att) if pt_att else 0
    return (
        punt_yards_bucket(pt_yards)
        + punt_avg_points(avg)
        + to_num(r["pt_inside_20"]) * 2.5
        + to_num(r["pt_blocked"]) * -4
    )


def compute_returning(r):
    return to_num(r["kickoff_return_yards"]) * 0.1 + to_num(r["punt_return_yards"]) * 0.2


# nflverse's `players.position` uses finer-grained codes than the Fantasy
# Rules' own position groups (e.g. ILB/MLB/OLB are all "LB" for scoring
# purposes) -- this collapses them onto the same buckets fantasyRulesData.js
# and FantasyScoresPage.jsx's position filter use. Anything not listed here
# (OL/OT/G/C/LS) isn't eligible for any of the position-restricted groups
# below, which matches reality -- those positions never appear in the
# offense/defense/special-teams stat tables anyway.
POSITION_GROUP = {
    "QB": "QB", "RB": "RB", "FB": "FB", "WR": "WR", "TE": "TE",
    "K": "PK", "P": "PN",
    "DT": "DT", "NT": "DT", "DL": "DT",
    "DE": "DE",
    "LB": "LB", "ILB": "LB", "MLB": "LB", "OLB": "LB",
    "CB": "CB", "DB": "CB",
    "S": "S", "FS": "S", "SAF": "S",
}


def position_group(raw_position):
    return POSITION_GROUP.get(raw_position)


# Position restrictions transcribed from the league's rules table (each
# group's header names exactly which positions it scores for) -- anyone
# else's stats in that source table are left uncounted for that group.
BLOCKING_BONUS_POSITIONS = {"TE", "FB"}
# The rules table gives Passing its own "QB Event" header, separate from
# Rushing/Receiving's "QB, RB, FB, WR, TE Event" header -- so a gadget-play
# completion by a non-QB doesn't score Passing points, even though the same
# player's carries/receptions elsewhere in the same game still would.
PASSING_POSITIONS = {"QB"}
RUSHING_RECEIVING_POSITIONS = {"QB", "RB", "FB", "WR", "TE"}
FUMBLES_FOULS_POSITIONS = {"QB", "RB", "FB", "WR", "TE", "PK", "PN", "DT", "DE", "LB", "CB", "S"}
RETURNING_POSITIONS = {"RB", "FB", "WR", "TE", "CB", "S", "LB"}
DEFENSE_IDP_POSITIONS = {"DT", "DE", "LB", "CB", "S"}


def build_fantasy_scores(season: int):
    db_path = DB_DIR / f"nfl_{season}.db"
    if not db_path.exists():
        print(f"  {db_path} not found, skipping season {season}")
        return
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    positions = {
        r["player_id"]: position_group(r["position"])
        for r in cur.execute("SELECT player_id, position FROM players")
    }

    cur.execute("DROP TABLE IF EXISTS player_game_fantasy_points")
    cur.execute(
        """CREATE TABLE player_game_fantasy_points (
            player_id TEXT NOT NULL,
            game_id TEXT NOT NULL,
            team TEXT,
            passing_points REAL,
            rushing_points REAL,
            receiving_points REAL,
            blocking_bonus_points REAL,
            fumbles_fouls_points REAL,
            defense_points REAL,
            pressure_points REAL,
            coverage_points REAL,
            turnover_points REAL,
            kicking_points REAL,
            punting_points REAL,
            returning_points REAL,
            total_points REAL NOT NULL,
            PRIMARY KEY (player_id, game_id)
        )"""
    )

    # player_id+game_id -> accumulated row of category points, merged
    # across all three source tables since one player can (rarely) show
    # up in more than one for the same game (e.g. a fumble recovery
    # logged on the defense table for an offensive lineman).
    rows_by_key = {}

    def get_row(player_id, game_id, team):
        key = (player_id, game_id)
        if key not in rows_by_key:
            rows_by_key[key] = {
                "player_id": player_id, "game_id": game_id, "team": team,
                "passing": 0.0, "rushing": 0.0, "receiving": 0.0, "blocking_bonus": 0.0,
                "fumbles_fouls": 0.0, "pressure": 0.0, "coverage": 0.0, "turnover": 0.0,
                "kicking": 0.0, "punting": 0.0, "returning": 0.0,
            }
        return rows_by_key[key]

    n_off = n_def = n_st = 0
    for r in cur.execute("SELECT * FROM player_offense_stats"):
        row = get_row(r["player_id"], r["game_id"], r["team"])
        pos = positions.get(r["player_id"])
        if pos in PASSING_POSITIONS:
            row["passing"] += compute_passing(r)
        if pos in RUSHING_RECEIVING_POSITIONS:
            row["rushing"] += compute_rushing(r)
            row["receiving"] += compute_receiving(r)
        if pos in BLOCKING_BONUS_POSITIONS:
            row["blocking_bonus"] += compute_blocking_bonus(r)
        if pos in FUMBLES_FOULS_POSITIONS:
            row["fumbles_fouls"] += compute_offense_fumbles(r)
        n_off += 1

    for r in cur.execute("SELECT * FROM player_defense_stats"):
        row = get_row(r["player_id"], r["game_id"], r["team"])
        if positions.get(r["player_id"]) in DEFENSE_IDP_POSITIONS:
            row["pressure"] += compute_pressure(r)
            row["coverage"] += compute_coverage(r)
            row["turnover"] += compute_turnover(r)
            row["fumbles_fouls"] += compute_defense_fumbles(r)
        n_def += 1

    for r in cur.execute("SELECT * FROM player_special_teams_stats"):
        row = get_row(r["player_id"], r["game_id"], r["team"])
        row["kicking"] += compute_kicking(r)
        row["punting"] += compute_punting(r)
        if positions.get(r["player_id"]) in RETURNING_POSITIONS:
            row["returning"] += compute_returning(r)
        n_st += 1

    for row in rows_by_key.values():
        defense = row["pressure"] + row["coverage"] + row["turnover"]
        total = (
            row["passing"] + row["rushing"] + row["receiving"] + row["blocking_bonus"]
            + row["fumbles_fouls"] + defense + row["kicking"] + row["punting"] + row["returning"]
        )
        cur.execute(
            """INSERT INTO player_game_fantasy_points (
                player_id, game_id, team, passing_points, rushing_points, receiving_points,
                blocking_bonus_points, fumbles_fouls_points, defense_points, pressure_points,
                coverage_points, turnover_points, kicking_points, punting_points, returning_points,
                total_points
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                row["player_id"], row["game_id"], row["team"],
                round(row["passing"], 2), round(row["rushing"], 2), round(row["receiving"], 2),
                round(row["blocking_bonus"], 2), round(row["fumbles_fouls"], 2), round(defense, 2),
                round(row["pressure"], 2), round(row["coverage"], 2), round(row["turnover"], 2),
                round(row["kicking"], 2), round(row["punting"], 2), round(row["returning"], 2),
                round(total, 2),
            ),
        )

    conn.commit()
    print(f"  season {season}: {len(rows_by_key)} player-game rows "
          f"(from {n_off} offense + {n_def} defense + {n_st} special-teams rows)")
    conn.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--season", type=int, action="append", dest="seasons")
    args = parser.parse_args()
    seasons = args.seasons or [2024, 2025, 2026]
    print("Building fantasy scores...")
    for season in seasons:
        build_fantasy_scores(season)
    print("Done.")
