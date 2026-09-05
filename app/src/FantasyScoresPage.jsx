import { useEffect, useMemo, useState } from 'react'
import { supabase } from './supabaseClient'
import LoadingSpinner from './LoadingSpinner'

const SEASONS = [2026, 2025, 2024]
const DEFAULT_SEASON = 2025
const WEEKS = Array.from({ length: 18 }, (_, i) => i + 1)
const ROW_LIMIT = 50

// Two-level toggle: pick a top-level group, then (for anything but Weeks)
// which of its rule-sets to view. Each leaf's key maps to a real fantasy-
// points column (POINTS_COLUMN/TEAM_POINTS_COLUMN below) and to a raw-stat
// column set (STAT_COLUMNS). "Coaching > Defense/Offense" are the team-
// level Defensive/Offensive Coordinator stats, not the individual IDP
// Defense group -- kept as coach-defense/coach-offense so they don't
// collide with the top-level Defense group's own leaves.
const TOP_CATEGORIES = [
  { key: 'weeks', label: 'Weeks' },
  {
    key: 'offense',
    label: 'Offense',
    subs: [
      { key: 'passing', label: 'Passing' },
      { key: 'receiving', label: 'Receiving' },
      { key: 'rushing', label: 'Rushing' },
      { key: 'blocking-bonus', label: 'Blocking Bonus' },
    ],
  },
  {
    key: 'defense',
    label: 'Defense',
    subs: [
      { key: 'pressure', label: 'Pressure', note: 'TFL, QB Hits, Sacks' },
      { key: 'coverage', label: 'Coverage', note: 'Tackles, Assist Tackles, PDs' },
      { key: 'turnover', label: 'Turnover', note: 'FF, FR, INT, FR Yds, INT Ret Yds' },
    ],
  },
  {
    key: 'coaching',
    label: 'Coaching',
    subs: [
      { key: 'coach-head', label: 'Head' },
      { key: 'coach-defense', label: 'Defense' },
      { key: 'coach-offense', label: 'Offense' },
    ],
  },
  {
    key: 'special',
    label: 'Special',
    subs: [
      { key: 'kicking', label: 'Kicking' },
      { key: 'punting', label: 'Punting' },
      { key: 'returning', label: 'Returning' },
    ],
  },
]

// The underlying counting stats shown per leaf category -- these feed
// that category's fantasy points, per Fantasy Rules.
const STAT_COLUMNS = {
  passing: [
    { key: 'comp', label: 'Comp' },
    { key: 'att', label: 'Att' },
    { key: 'yds', label: 'Yds' },
    { key: 'td', label: 'TD' },
    { key: 'int', label: 'INT' },
  ],
  receiving: [
    { key: 'rec', label: 'Rec' },
    { key: 'targets', label: 'Targets' },
    { key: 'yds', label: 'Yds' },
    { key: 'td', label: 'TD' },
  ],
  rushing: [
    { key: 'att', label: 'Att' },
    { key: 'yds', label: 'Yds' },
    { key: 'td', label: 'TD' },
  ],
  'blocking-bonus': [
    { key: 'avgPassComp', label: 'Avg/Comp' },
    { key: 'avgRush', label: 'Avg/Rush' },
    { key: 'rushAtt', label: 'Rush Att' },
    { key: 'avgRec', label: 'Avg/Rec' },
  ],
  pressure: [
    { key: 'tfl', label: 'TFL' },
    { key: 'qbHits', label: 'QB Hits' },
    { key: 'sacks', label: 'Sacks' },
  ],
  coverage: [
    { key: 'tkl', label: 'Tackles' },
    { key: 'ast', label: 'Assists' },
    { key: 'pd', label: 'PD' },
  ],
  turnover: [
    { key: 'ff', label: 'FF' },
    { key: 'fr', label: 'FR' },
    { key: 'int', label: 'INT' },
    { key: 'frYds', label: 'FR Yds' },
    { key: 'intYds', label: 'INT Ret Yds' },
  ],
  'coach-head': [
    { key: 'won', label: 'Won' },
    { key: 'lost', label: 'Lost' },
    { key: 'tied', label: 'Tied' },
    { key: 'ptDiff', label: 'Pt Diff' },
  ],
  'coach-defense': [
    { key: 'oppPassTd', label: 'Opp Pass TD' },
    { key: 'oppRushTd', label: 'Opp Rush TD' },
    { key: 'sacks', label: 'Sacks' },
    { key: 'int', label: 'INT' },
    { key: 'passYdsAllowed', label: 'Pass Yds/G Allowed' },
    { key: 'rushYdsAllowed', label: 'Rush Yds/G Allowed' },
  ],
  'coach-offense': [
    { key: 'passTd', label: 'Pass TD' },
    { key: 'rushTd', label: 'Rush TD' },
    { key: 'fgMade', label: 'FG Made' },
    { key: 'firstDowns', label: 'First Downs' },
    { key: 'fumblesLost', label: 'Fumbles Lost' },
  ],
  kicking: [
    { key: 'fgMade', label: 'FG Made' },
    { key: 'fgAtt', label: 'FG Att' },
    { key: 'xpMade', label: 'XP Made' },
  ],
  punting: [
    { key: 'punts', label: 'Punts' },
    { key: 'puntYds', label: 'Punt Yds' },
    { key: 'puntAvg', label: 'Punt Avg' },
  ],
  returning: [
    { key: 'kr', label: 'KR' },
    { key: 'krYds', label: 'KR Yds' },
    { key: 'pr', label: 'PR' },
    { key: 'prYds', label: 'PR Yds' },
  ],
}

// Which player_season_fantasy_points / team_season_fantasy_points column
// ranks each leaf category, and (for player categories) which raw stat
// rollup feeds STAT_COLUMNS' values.
const POINTS_COLUMN = {
  passing: 'passing_points', receiving: 'receiving_points', rushing: 'rushing_points',
  'blocking-bonus': 'blocking_bonus_points', pressure: 'pressure_points', coverage: 'coverage_points',
  turnover: 'turnover_points', kicking: 'kicking_points', punting: 'punting_points',
  returning: 'returning_points',
}
const TEAM_POINTS_COLUMN = {
  'coach-head': 'coach_head_points', 'coach-offense': 'coach_offense_points',
  'coach-defense': 'coach_defense_points',
}
const TEAM_AVG_COLUMN = {
  'coach-head': 'coach_head_avg', 'coach-offense': 'coach_offense_avg',
  'coach-defense': 'coach_defense_avg',
}
const COACH_LABEL = { 'coach-head': 'Head Coach', 'coach-offense': 'ST', 'coach-defense': 'Def' }

// nflverse's own position codes are 'K'/'P' -- the legal-lineup slots
// (per fantasyRulesData.js's STARTING_LINEUP_ROWS) call them PK/PN.
function legalPosition(position) {
  if (position === 'QB') return 'QB'
  if (position === 'K') return 'PK'
  if (position === 'P') return 'PN'
  return 'IDP/Skill'
}

function lastNameOnly(fullName) {
  const rest = fullName.split(' ').slice(1).join(' ')
  return rest || fullName
}

function round1(n) {
  if (n == null || Number.isNaN(n)) return null
  return Math.round(n * 10) / 10
}

// PostgREST caps a single response at 1000 rows -- fine for anything
// filtered to one player/team, but these leaguewide rank pools need every
// row, so page through with .range() until a page comes back short.
async function fetchAllRows(queryFactory) {
  const pageSize = 1000
  let allData = []
  let from = 0
  for (;;) {
    const { data, error } = await queryFactory().range(from, from + pageSize - 1)
    if (error) return { data: null, error }
    allData = allData.concat(data)
    if (data.length < pageSize) break
    from += pageSize
  }
  return { data: allData, error: null }
}

// Merges a player's rows across teams (a mid-season trade means more than
// one team row per player per season) into one summed totals object, plus
// whichever team was seen last.
function sumByPlayer(rows, fields) {
  const map = new Map()
  for (const r of rows) {
    const cur = map.get(r.player_id) ?? { team: r.team, ...Object.fromEntries(fields.map((f) => [f, 0])) }
    cur.team = r.team
    for (const f of fields) cur[f] += Number(r[f] ?? 0)
    map.set(r.player_id, cur)
  }
  return map
}

function sumByTeam(rows, fields) {
  const map = new Map()
  for (const r of rows) {
    const cur = map.get(r.team) ?? Object.fromEntries(fields.map((f) => [f, 0]))
    for (const f of fields) cur[f] += Number(r[f] ?? 0)
    map.set(r.team, cur)
  }
  return map
}

// Pixel widths/offsets for the frozen columns (logo, name, total, avg) --
// sticky-left needs each cell's own cumulative offset and an opaque
// background so scrolled columns don't show through.
const COL_WIDTHS = { logo: 44, name: 108, total: 64, avg: 60 }
const COL_LEFT = {
  logo: 0,
  name: COL_WIDTHS.logo,
  total: COL_WIDTHS.logo + COL_WIDTHS.name,
  avg: COL_WIDTHS.logo + COL_WIDTHS.name + COL_WIDTHS.total,
}
const SCROLL_COL_WIDTH = 56
const FROZEN_WIDTH = COL_LEFT.avg + COL_WIDTHS.avg
const FROZEN_TD = 'sticky z-10 bg-neutral-50 dark:bg-neutral-900'
const DIVIDER_STYLE = { borderRight: '1px solid rgba(120,120,120,0.25)' }

function ToggleButton({ active, onClick, children, title }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
        active
          ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900'
          : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700'
      }`}
    >
      {children}
    </button>
  )
}

export default function FantasyScoresPage() {
  const [season, setSeason] = useState(DEFAULT_SEASON)
  const [topKey, setTopKey] = useState('weeks')
  const [subKey, setSubKey] = useState(null)
  const [players, setPlayers] = useState([])
  const [teams, setTeams] = useState([])
  const [fantasyPoints, setFantasyPoints] = useState([])
  const [gamePoints, setGamePoints] = useState([])
  const [offenseStats, setOffenseStats] = useState([])
  const [defenseStats, setDefenseStats] = useState([])
  const [specialStats, setSpecialStats] = useState([])
  const [teamFantasyPoints, setTeamFantasyPoints] = useState([])
  const [teamSeasonStats, setTeamSeasonStats] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchAllRows(() => supabase.from('players').select('player_id, display_name, position')).then(
      ({ data }) => data && setPlayers(data),
    )
    supabase.from('teams').select('team_abbr, team_name').then(({ data }) => data && setTeams(data))
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([
      fetchAllRows(() => supabase.from('player_season_fantasy_points').select('*').eq('season', season)),
      fetchAllRows(() =>
        supabase
          .from('player_game_fantasy_points')
          .select('player_id, total_points, games!inner(week, season)')
          .eq('games.season', season),
      ),
      fetchAllRows(() => supabase.from('player_season_offense_stats').select('*').eq('season', season)),
      fetchAllRows(() => supabase.from('player_season_defense_stats').select('*').eq('season', season)),
      fetchAllRows(() => supabase.from('player_season_special_teams_stats').select('*').eq('season', season)),
      fetchAllRows(() => supabase.from('team_season_fantasy_points').select('*').eq('season', season)),
      fetchAllRows(() => supabase.from('team_season_stats').select('*').eq('season', season)),
    ]).then(([fp, gp, off, def, spec, tfp, tss]) => {
      if (cancelled) return
      setFantasyPoints(fp.data ?? [])
      setGamePoints(gp.data ?? [])
      setOffenseStats(off.data ?? [])
      setDefenseStats(def.data ?? [])
      setSpecialStats(spec.data ?? [])
      setTeamFantasyPoints(tfp.data ?? [])
      setTeamSeasonStats(tss.data ?? [])
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [season])

  const playersById = useMemo(() => new Map(players.map((p) => [p.player_id, p])), [players])
  const teamsByAbbr = useMemo(() => new Map(teams.map((t) => [t.team_abbr, t])), [teams])
  const teamSeasonByAbbr = useMemo(() => new Map(teamSeasonStats.map((r) => [r.team, r])), [teamSeasonStats])

  const offenseByPlayer = useMemo(
    () =>
      sumByPlayer(offenseStats, [
        'completions', 'attempts', 'passing_yards', 'passing_tds', 'passing_interceptions',
        'carries', 'rushing_yards', 'rushing_tds', 'receptions', 'targets', 'receiving_yards',
        'receiving_tds',
      ]),
    [offenseStats],
  )
  const defenseByPlayer = useMemo(
    () =>
      sumByPlayer(defenseStats, [
        'def_tackles_for_loss', 'def_qb_hits', 'def_sacks', 'def_tackles_solo',
        'def_tackles_with_assist', 'def_pass_defended', 'def_fumbles_forced', 'fumble_recovery_opp',
        'def_interceptions', 'fumble_recovery_yards_opp',
      ]),
    [defenseStats],
  )
  const specialByPlayer = useMemo(
    () =>
      sumByPlayer(specialStats, [
        'fg_made', 'fg_att', 'pat_made', 'pt_att', 'pt_yards', 'kickoff_returns',
        'kickoff_return_yards', 'punt_returns', 'punt_return_yards',
      ]),
    [specialStats],
  )
  const firstDownsByTeam = useMemo(
    () => sumByTeam(offenseStats, ['passing_first_downs', 'rushing_first_downs', 'receiving_first_downs']),
    [offenseStats],
  )
  const weekScoresByPlayer = useMemo(() => {
    const map = new Map()
    for (const r of gamePoints) {
      const week = r.games?.week
      if (!week) continue
      const cur = map.get(r.player_id) ?? {}
      cur[week] = (cur[week] ?? 0) + Number(r.total_points ?? 0)
      map.set(r.player_id, cur)
    }
    return map
  }, [gamePoints])

  function teamOf(playerId) {
    return (
      offenseByPlayer.get(playerId)?.team ?? defenseByPlayer.get(playerId)?.team
      ?? specialByPlayer.get(playerId)?.team ?? null
    )
  }

  function statValuesFor(category, playerId, team) {
    switch (category) {
      case 'passing': {
        const s = offenseByPlayer.get(playerId)
        return s && { comp: s.completions, att: s.attempts, yds: s.passing_yards, td: s.passing_tds, int: s.passing_interceptions }
      }
      case 'receiving': {
        const s = offenseByPlayer.get(playerId)
        return s && { rec: s.receptions, targets: s.targets, yds: s.receiving_yards, td: s.receiving_tds }
      }
      case 'rushing': {
        const s = offenseByPlayer.get(playerId)
        return s && { att: s.carries, yds: s.rushing_yards, td: s.rushing_tds }
      }
      case 'blocking-bonus': {
        const s = offenseByPlayer.get(playerId)
        if (!s) return null
        return {
          avgPassComp: s.completions ? round1(s.passing_yards / s.completions) : 0,
          avgRush: s.carries ? round1(s.rushing_yards / s.carries) : 0,
          rushAtt: s.carries,
          avgRec: s.receptions ? round1(s.receiving_yards / s.receptions) : 0,
        }
      }
      case 'pressure': {
        const s = defenseByPlayer.get(playerId)
        return s && { tfl: s.def_tackles_for_loss, qbHits: s.def_qb_hits, sacks: s.def_sacks }
      }
      case 'coverage': {
        const s = defenseByPlayer.get(playerId)
        return s && { tkl: s.def_tackles_solo, ast: s.def_tackles_with_assist, pd: s.def_pass_defended }
      }
      case 'turnover': {
        const s = defenseByPlayer.get(playerId)
        return (
          s && {
            ff: s.def_fumbles_forced, fr: s.fumble_recovery_opp, int: s.def_interceptions,
            frYds: s.fumble_recovery_yards_opp, intYds: s.def_interception_yards,
          }
        )
      }
      case 'kicking': {
        const s = specialByPlayer.get(playerId)
        return s && { fgMade: s.fg_made, fgAtt: s.fg_att, xpMade: s.pat_made }
      }
      case 'punting': {
        const s = specialByPlayer.get(playerId)
        return s && { punts: s.pt_att, puntYds: s.pt_yards, puntAvg: s.pt_att ? round1(s.pt_yards / s.pt_att) : 0 }
      }
      case 'returning': {
        const s = specialByPlayer.get(playerId)
        return s && { kr: s.kickoff_returns, krYds: s.kickoff_return_yards, pr: s.punt_returns, prYds: s.punt_return_yards }
      }
      case 'coach-head': {
        const t = teamSeasonByAbbr.get(team)
        return t && { won: t.wins, lost: t.losses, tied: t.ties, ptDiff: t.point_diff }
      }
      case 'coach-offense': {
        const t = teamSeasonByAbbr.get(team)
        if (!t) return null
        const fd = firstDownsByTeam.get(team)
        const firstDowns = fd ? fd.passing_first_downs + fd.rushing_first_downs + fd.receiving_first_downs : 0
        return { passTd: t.pass_td, rushTd: t.rush_td, fgMade: t.fg_made, firstDowns, fumblesLost: t.turnovers_fumble }
      }
      case 'coach-defense': {
        const t = teamSeasonByAbbr.get(team)
        return (
          t && {
            oppPassTd: t.pass_td_allowed, oppRushTd: t.rush_td_allowed, sacks: t.sacks, int: t.def_ints,
            passYdsAllowed: round1(t.pass_yds_allowed_avg), rushYdsAllowed: round1(t.rush_yds_allowed_avg),
          }
        )
      }
      default:
        return null
    }
  }

  const topCategory = TOP_CATEGORIES.find((c) => c.key === topKey)
  const isWeeks = topKey === 'weeks'
  const isCoaching = topKey === 'coaching'
  const activeSub = isWeeks ? null : subKey ?? topCategory.subs[0].key

  function selectTop(key) {
    setTopKey(key)
    const cat = TOP_CATEGORIES.find((c) => c.key === key)
    setSubKey(cat.subs ? cat.subs[0].key : null)
  }

  const rows = useMemo(() => {
    if (isWeeks) {
      return fantasyPoints
        .slice()
        .sort((a, b) => Number(b.total_points) - Number(a.total_points))
        .slice(0, ROW_LIMIT)
        .map((fp) => {
          const player = playersById.get(fp.player_id)
          return {
            key: fp.player_id,
            playerId: fp.player_id,
            name: player?.display_name ?? fp.player_id,
            legalPosition: legalPosition(player?.position),
            team: teamOf(fp.player_id) ?? '???',
            total: Number(fp.total_points),
            avg: Number(fp.avg_points),
          }
        })
    }

    if (isCoaching) {
      const col = TEAM_POINTS_COLUMN[activeSub]
      const avgCol = TEAM_AVG_COLUMN[activeSub]
      return teamFantasyPoints
        .filter((r) => r[col] != null)
        .slice()
        .sort((a, b) => Number(b[col]) - Number(a[col]))
        .slice(0, ROW_LIMIT)
        .map((r) => ({
          key: r.team,
          name: teamsByAbbr.get(r.team)?.team_name ?? r.team,
          legalPosition: COACH_LABEL[activeSub],
          team: r.team,
          total: Number(r[col]),
          avg: Number(r[avgCol]),
          isTeam: true,
          statValues: statValuesFor(activeSub, null, r.team),
        }))
    }

    const col = POINTS_COLUMN[activeSub]
    return fantasyPoints
      .filter((r) => r[col] != null && Number(r[col]) !== 0)
      .slice()
      .sort((a, b) => Number(b[col]) - Number(a[col]))
      .slice(0, ROW_LIMIT)
      .map((fp) => {
        const player = playersById.get(fp.player_id)
        const team = teamOf(fp.player_id) ?? '???'
        return {
          key: fp.player_id,
          playerId: fp.player_id,
          name: player?.display_name ?? fp.player_id,
          legalPosition: legalPosition(player?.position),
          team,
          total: Number(fp[col]),
          avg: round1(Number(fp[col]) / Number(fp.games)),
          statValues: statValuesFor(activeSub, fp.player_id, team),
        }
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isWeeks, isCoaching, activeSub, fantasyPoints, teamFantasyPoints, playersById, teamsByAbbr,
    offenseByPlayer, defenseByPlayer, specialByPlayer, teamSeasonByAbbr, firstDownsByTeam,
  ])

  const scrollColumns = isWeeks ? WEEKS.map((w) => ({ key: w, label: `Wk ${w}` })) : STAT_COLUMNS[activeSub]
  // table-layout:fixed alone doesn't stop a <table> shrinking below the
  // sum of its declared column widths to fit its container -- an explicit
  // total width forces it, which is what makes the wrapper's
  // overflow-x-auto have real excess width to scroll.
  const tableWidth = FROZEN_WIDTH + SCROLL_COL_WIDTH * scrollColumns.length

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <h1 className="mb-2 text-2xl font-semibold text-neutral-900 dark:text-neutral-100">Fantasy Scores</h1>
      <p className="mb-4 max-w-2xl text-sm text-neutral-500">
        Top fantasy scorers among the legal roster positions, computed from real nflverse box scores using the{' '}
        <a href="#/rules" className="underline">
          Fantasy Rules
        </a>{' '}
        scoring formulas. Refreshed automatically every night as new games are played -- a few sub-bonuses
        aren't computable from the available per-game stat aggregates (touchdown-length tiers, some
        cross-player attribution, individual blocked-kick credit, and two Defensive Coordinator items); see{' '}
        <code className="rounded bg-neutral-100 px-1 py-0.5 text-xs dark:bg-neutral-800">
          build_fantasy_scores.py
        </code>{' '}
        and{' '}
        <code className="rounded bg-neutral-100 px-1 py-0.5 text-xs dark:bg-neutral-800">
          build_coach_fantasy_scores.py
        </code>{' '}
        for the exact list.
      </p>

      <div className="mb-4 flex gap-2">
        {SEASONS.map((y) => (
          <button
            key={y}
            type="button"
            onClick={() => setSeason(y)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              y === season
                ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900'
                : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700'
            }`}
          >
            {y}
          </button>
        ))}
      </div>

      <div className="mb-1.5 flex flex-wrap gap-1.5">
        {TOP_CATEGORIES.map((c) => (
          <ToggleButton key={c.key} active={topKey === c.key} onClick={() => selectTop(c.key)}>
            {c.label}
          </ToggleButton>
        ))}
      </div>

      {!isWeeks && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {topCategory.subs.map((s) => (
            <ToggleButton key={s.key} active={activeSub === s.key} onClick={() => setSubKey(s.key)} title={s.note}>
              {s.label}
            </ToggleButton>
          ))}
        </div>
      )}
      {isWeeks && <div className="mb-4" />}

      {loading ? (
        <LoadingSpinner />
      ) : (
        <div className="overflow-x-auto">
          <table className="border-collapse text-sm" style={{ tableLayout: 'fixed', width: tableWidth }}>
            <thead>
              <tr className="border-b border-neutral-200 text-left text-neutral-500 dark:border-neutral-800">
                <th className={`${FROZEN_TD} py-2 font-medium`} style={{ left: COL_LEFT.logo, width: COL_WIDTHS.logo }} />
                <th className={`${FROZEN_TD} py-2 pr-2 font-medium`} style={{ left: COL_LEFT.name, width: COL_WIDTHS.name }}>
                  Player
                </th>
                <th
                  className={`${FROZEN_TD} px-2 py-2 text-right font-medium`}
                  style={{ left: COL_LEFT.total, width: COL_WIDTHS.total }}
                >
                  Total
                </th>
                <th
                  className={`${FROZEN_TD} px-2 py-2 text-right font-medium`}
                  style={{ left: COL_LEFT.avg, width: COL_WIDTHS.avg, ...DIVIDER_STYLE }}
                >
                  Avg
                </th>
                {scrollColumns.map((col) => (
                  <th
                    key={col.key}
                    className="border-l border-neutral-200 px-2 py-2 text-right font-medium dark:border-neutral-800"
                    style={{ width: SCROLL_COL_WIDTH }}
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={4 + scrollColumns.length} className="py-6 text-center text-sm text-neutral-400">
                    No fantasy data yet for {season} -- check back once games are played.
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.key} className="border-b border-neutral-100 dark:border-neutral-900">
                  <td className={`${FROZEN_TD} py-2`} style={{ left: COL_LEFT.logo, width: COL_WIDTHS.logo }}>
                    <img
                      src={`${import.meta.env.BASE_URL}logos/${r.team}.png`}
                      alt={r.team}
                      className="h-6 w-6 object-contain"
                    />
                  </td>
                  <td className={`${FROZEN_TD} py-2 pr-2`} style={{ left: COL_LEFT.name, width: COL_WIDTHS.name }}>
                    <div className="truncate font-medium text-neutral-900 dark:text-neutral-100">
                      {r.isTeam ? r.name : lastNameOnly(r.name)}
                    </div>
                    <div className="text-xs text-neutral-400">{r.legalPosition}</div>
                  </td>
                  <td
                    className={`${FROZEN_TD} px-2 py-2 text-right font-semibold tabular-nums text-neutral-900 dark:text-neutral-100`}
                    style={{ left: COL_LEFT.total, width: COL_WIDTHS.total }}
                  >
                    {r.total}
                  </td>
                  <td
                    className={`${FROZEN_TD} px-2 py-2 text-right tabular-nums text-neutral-600 dark:text-neutral-400`}
                    style={{ left: COL_LEFT.avg, width: COL_WIDTHS.avg, ...DIVIDER_STYLE }}
                  >
                    {r.avg}
                  </td>
                  {isWeeks
                    ? WEEKS.map((w) => (
                        <td
                          key={w}
                          className="border-l border-neutral-100 px-2 py-2 text-right tabular-nums text-neutral-600 dark:border-neutral-900 dark:text-neutral-400"
                        >
                          {weekScoresByPlayer.get(r.playerId)?.[w] ?? '—'}
                        </td>
                      ))
                    : scrollColumns.map((col) => (
                        <td
                          key={col.key}
                          className="border-l border-neutral-100 px-2 py-2 text-right tabular-nums text-neutral-600 dark:border-neutral-900 dark:text-neutral-400"
                        >
                          {r.statValues?.[col.key] ?? '—'}
                        </td>
                      ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
