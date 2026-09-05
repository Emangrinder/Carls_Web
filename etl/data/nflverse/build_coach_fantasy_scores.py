#!/usr/bin/env python3
"""Computes per-game fantasy points for the three team-level coaching
roles -- Head Coach, Offensive Coordinator (ST), Defensive Coordinator
(DEF) -- from the same per-game player stat tables build_fantasy_scores.py
uses, aggregated up to the team level first (mirroring the logic of the
`team_game_stats` Postgres materialized view, done here in SQLite so it's
available before that view can refresh). Source formulas:
app/src/fantasyRulesData.js (the three `independent: true` rule groups).

Run against an already-built season DB (etl/db/nfl_<season>.db), same as
build_fantasy_scores.py, and after it (no dependency between the two, but
keeping them adjacent in the ETL run makes sense).

KNOWN LIMITATIONS -- same spirit as build_fantasy_scores.py's docstring:
  - Opponent Penalty First Downs (Defensive Coordinator) -- our stat
    aggregates don't break penalties down by whether they resulted in a
    first down, only total penalty yardage.
  - Opponent Fourth Downs Failed (Defensive Coordinator) -- no 4th-down
    conversion tracking in the per-player aggregates.
Every other rule in Head Coach/Offensive Coordinator/Defensive Coordinator
is computed in full.
"""
import argparse
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent
DB_DIR = ROOT / "db"


def to_num(v):
    return v if v is not None else 0


def yards_allowed_tier(yards, per_yard_points):
    """Shared shape for Passing/Rushing Yards Allowed: a flat +5 bonus for
    holding an opponent under 100 yards, else a per-yard rate beyond that
    (positive for passing, negative for rushing, per the rules table)."""
    if yards < 100:
        return 5
    return yards * per_yard_points


def points_only_tier(points_for):
    """Offensive Points Only: a flat -3 penalty for scoring 0-6 points."""
    return -3 if 0 <= points_for <= 6 else 0


def points_against_tier(points_against):
    """Offensive Points Against: a flat +5 bonus for allowing 0-9 points."""
    return 5 if 0 <= points_against <= 9 else 0


def compute_head_coach(points_for, points_against):
    diff = points_for - points_against
    result = diff * 0.3
    if points_for > points_against:
        result += 7
    elif points_for < points_against:
        result += 3
    else:
        result += 5
    return result


def compute_offensive_coordinator(own, opp):
    return (
        own["pass_td"] * 1.5
        + own["pass_yds"] * 0.01
        + own["sacks_suffered"] * -1
        + own["rush_td"] * 1.5
        + own["rush_yds"] * 0.02
        + own["fg_made"] * 0.5
        + own["fumbles_lost"] * -1.5
        + own["ints_thrown"] * -1.5
        + opp["def_tds"] * -0.5
        + points_only_tier(own["points_for"])
        + own["first_downs"] * 0.1
    )


def compute_defensive_coordinator(own, opp):
    opp_incompletions = opp["attempts"] - opp["completions"]
    return (
        opp["pass_td"] * -1
        + opp_incompletions * 0.2
        + opp["rush_td"] * -1
        + opp["punts"] * 1.5
        + own["fumble_recovery_opp"] * 3
        + own["def_ints"] * 3
        + opp["fg_blocked"] * 4
        + opp["pt_blocked"] * 4
        + opp["pat_blocked"] * 2
        + own["sacks"] * 2
        + own["qb_hits"] * 0.3
        + own["def_safeties"] * 5
        + points_against_tier(own["points_against"])
        + yards_allowed_tier(opp["pass_yds"], 0.01)
        + yards_allowed_tier(opp["rush_yds"], -0.02)
        + own["def_tds"] * 6
    )


def build_coach_fantasy_scores(season: int):
    db_path = DB_DIR / f"nfl_{season}.db"
    if not db_path.exists():
        print(f"  {db_path} not found, skipping season {season}")
        return
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    cur.execute("DROP TABLE IF EXISTS team_game_fantasy_points")
    cur.execute(
        """CREATE TABLE team_game_fantasy_points (
            team TEXT NOT NULL,
            game_id TEXT NOT NULL,
            coach_head_points REAL,
            coach_offense_points REAL,
            coach_defense_points REAL,
            PRIMARY KEY (team, game_id)
        )"""
    )

    def blank_team_row():
        return {
            "pass_td": 0, "pass_yds": 0, "rush_td": 0, "rush_yds": 0, "ints_thrown": 0,
            "fumbles_lost": 0, "first_downs": 0, "sacks_suffered": 0,
            "sacks": 0, "qb_hits": 0, "def_ints": 0, "def_tds": 0, "fumble_recovery_opp": 0,
            "def_safeties": 0, "fg_made": 0, "fg_blocked": 0, "pt_blocked": 0, "pat_blocked": 0,
            "punts": 0, "completions": 0, "attempts": 0,
        }

    # team_id+game_id -> aggregated raw team-game stat line, built the same
    # way team_game_stats does but kept local to this script.
    team_game = {}

    def get_team_row(game_id, team):
        key = (game_id, team)
        if key not in team_game:
            team_game[key] = blank_team_row()
        return team_game[key]

    for r in cur.execute("SELECT * FROM player_offense_stats"):
        row = get_team_row(r["game_id"], r["team"])
        row["pass_td"] += to_num(r["passing_tds"])
        row["pass_yds"] += to_num(r["passing_yards"])
        row["rush_td"] += to_num(r["rushing_tds"])
        row["rush_yds"] += to_num(r["rushing_yards"])
        row["ints_thrown"] += to_num(r["passing_interceptions"])
        row["fumbles_lost"] += (
            to_num(r["sack_fumbles_lost"]) + to_num(r["rushing_fumbles_lost"])
            + to_num(r["receiving_fumbles_lost"])
        )
        row["first_downs"] += (
            to_num(r["passing_first_downs"]) + to_num(r["rushing_first_downs"])
            + to_num(r["receiving_first_downs"])
        )
        row["sacks_suffered"] += to_num(r["sacks_suffered"])
        row["completions"] += to_num(r["completions"])
        row["attempts"] += to_num(r["attempts"])

    for r in cur.execute("SELECT * FROM player_defense_stats"):
        row = get_team_row(r["game_id"], r["team"])
        row["sacks"] += to_num(r["def_sacks"])
        row["qb_hits"] += to_num(r["def_qb_hits"])
        row["def_ints"] += to_num(r["def_interceptions"])
        row["def_tds"] += to_num(r["def_tds"])
        row["fumble_recovery_opp"] += to_num(r["fumble_recovery_opp"])
        row["def_safeties"] += to_num(r["def_safeties"])

    for r in cur.execute("SELECT * FROM player_special_teams_stats"):
        row = get_team_row(r["game_id"], r["team"])
        row["fg_made"] += to_num(r["fg_made"])
        row["fg_blocked"] += to_num(r["fg_blocked"])
        row["pt_blocked"] += to_num(r["pt_blocked"])
        row["pat_blocked"] += to_num(r["pat_blocked"])
        row["punts"] += to_num(r["pt_att"])

    # A separate cursor for the inserts below -- reusing `cur` itself would
    # clobber the SELECT statement it's still iterating over, silently
    # truncating this loop to its first row.
    write_cur = conn.cursor()
    n_games = 0
    for g in cur.execute(
        "SELECT game_id, home_team, away_team, home_score, away_score FROM games "
        "WHERE home_score IS NOT NULL AND away_score IS NOT NULL"
    ):
        home = dict(get_team_row(g["game_id"], g["home_team"]))
        away = dict(get_team_row(g["game_id"], g["away_team"]))
        home["points_for"], home["points_against"] = g["home_score"], g["away_score"]
        away["points_for"], away["points_against"] = g["away_score"], g["home_score"]

        for team, own, opp in ((g["home_team"], home, away), (g["away_team"], away, home)):
            write_cur.execute(
                """INSERT INTO team_game_fantasy_points (
                    team, game_id, coach_head_points, coach_offense_points, coach_defense_points
                ) VALUES (?,?,?,?,?)""",
                (
                    team, g["game_id"],
                    round(compute_head_coach(own["points_for"], own["points_against"]), 3),
                    round(compute_offensive_coordinator(own, opp), 3),
                    round(compute_defensive_coordinator(own, opp), 3),
                ),
            )
        n_games += 1

    conn.commit()
    print(f"  season {season}: {n_games} completed games ({n_games * 2} team-game rows)")
    conn.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--season", type=int, action="append", dest="seasons")
    args = parser.parse_args()
    seasons = args.seasons or [2024, 2025, 2026]
    print("Building coach fantasy scores...")
    for season in seasons:
        build_coach_fantasy_scores(season)
    print("Done.")
