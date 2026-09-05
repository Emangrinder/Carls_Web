import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from './supabaseClient'
import LoadingSpinner from './LoadingSpinner'

const SEASONS = [2026, 2025, 2024]
const DEFAULT_SEASON = 2025
const WEEKS = Array.from({ length: 18 }, (_, i) => i + 1)
const ROW_LIMITS = [50, 100, 250]
const DEFAULT_ROW_LIMIT = 50

// nflverse's `players.position` uses finer-grained codes than the Fantasy
// Rules' own position groups -- collapses them onto the same buckets
// etl/data/nflverse/build_fantasy_scores.py uses (keep both in sync).
const POSITION_GROUP = {
  QB: 'QB', RB: 'RB', FB: 'FB', WR: 'WR', TE: 'TE',
  K: 'PK', P: 'PN',
  DT: 'DT', NT: 'DT', DL: 'DT',
  DE: 'DE',
  LB: 'LB', ILB: 'LB', MLB: 'LB', OLB: 'LB',
  CB: 'CB', DB: 'CB',
  S: 'S', FS: 'S', SAF: 'S',
}
function positionGroup(rawPosition) {
  return POSITION_GROUP[rawPosition] ?? null
}
const SKILL_POSITIONS = new Set(['RB', 'FB', 'TE', 'WR'])
const IDP_POSITIONS = new Set(['DT', 'DE', 'LB', 'CB', 'S'])

// A separate filter dimension from the Weeks/Offense/etc toggles above --
// narrows whichever leaderboard is currently showing down to one position
// (or the Skill/IDP position-group buckets). Which options are even shown
// depends on the current Table Type (see positionFiltersFor below): an
// independent role (Head Coach/Team D/Team O) only offers itself, Offense/
// Defense only offer their own side's positions, Kicking/Punting only
// PK/PN, and Returning offers both sides since either can return kicks.
const ALL_FILTER = { key: 'all', label: 'All' }
const QB_FILTER = { key: 'QB', label: 'QB' }
const SKILL_FILTER = { key: 'Skill', label: 'Skill' }
const RB_FILTER = { key: 'RB', label: 'RB' }
const FB_FILTER = { key: 'FB', label: 'FB' }
const TE_FILTER = { key: 'TE', label: 'TE' }
const WR_FILTER = { key: 'WR', label: 'WR' }
const IDP_FILTER = { key: 'IDP', label: 'IDP' }
const DT_FILTER = { key: 'DT', label: 'DT' }
const DE_FILTER = { key: 'DE', label: 'DE' }
const LB_FILTER = { key: 'LB', label: 'LB' }
const CB_FILTER = { key: 'CB', label: 'CB' }
const S_FILTER = { key: 'S', label: 'S' }
const PK_FILTER = { key: 'PK', label: 'PK' }
const PN_FILTER = { key: 'PN', label: 'PN' }
const HC_FILTER = { key: 'HC', label: 'Head Coach' }
const TEAM_D_FILTER = { key: 'TeamD', label: 'Team D' }
const TEAM_O_FILTER = { key: 'TeamO', label: 'Team O' }

const OFFENSE_FILTERS = [ALL_FILTER, QB_FILTER, SKILL_FILTER, RB_FILTER, FB_FILTER, TE_FILTER, WR_FILTER]
const DEFENSE_FILTERS = [ALL_FILTER, IDP_FILTER, DT_FILTER, DE_FILTER, LB_FILTER, CB_FILTER, S_FILTER]
const RETURN_FILTERS = [
  ALL_FILTER, SKILL_FILTER, RB_FILTER, FB_FILTER, TE_FILTER, WR_FILTER,
  IDP_FILTER, DT_FILTER, DE_FILTER, LB_FILTER, CB_FILTER, S_FILTER,
]
const KICKING_FILTERS = [ALL_FILTER, PK_FILTER]
const PUNTING_FILTERS = [ALL_FILTER, PN_FILTER]
const FULL_FILTERS = [
  ALL_FILTER, QB_FILTER, SKILL_FILTER, RB_FILTER, FB_FILTER, TE_FILTER, WR_FILTER,
  IDP_FILTER, DT_FILTER, DE_FILTER, LB_FILTER, CB_FILTER, S_FILTER,
  PK_FILTER, PN_FILTER, HC_FILTER, TEAM_D_FILTER, TEAM_O_FILTER,
]

function positionFiltersFor(topKey, activeSub) {
  if (topKey === 'offense') return OFFENSE_FILTERS
  if (topKey === 'defense') return DEFENSE_FILTERS
  if (topKey === 'coaching') {
    if (activeSub === 'coach-head') return [ALL_FILTER, HC_FILTER]
    if (activeSub === 'coach-offense') return [ALL_FILTER, TEAM_O_FILTER]
    if (activeSub === 'coach-defense') return [ALL_FILTER, TEAM_D_FILTER]
  }
  if (topKey === 'special') {
    if (activeSub === 'kicking') return KICKING_FILTERS
    if (activeSub === 'punting') return PUNTING_FILTERS
    if (activeSub === 'returning') return RETURN_FILTERS
  }
  return FULL_FILTERS // Weeks -- everyone's on the same leaderboard there
}

const TEAM_ROLE_FILTERS = { HC: 'coach-head', TeamD: 'coach-defense', TeamO: 'coach-offense' }
function matchesPositionFilter(filterKey, normalizedPos) {
  if (filterKey === 'all') return true
  if (filterKey === 'Skill') return SKILL_POSITIONS.has(normalizedPos)
  if (filterKey === 'IDP') return IDP_POSITIONS.has(normalizedPos)
  return normalizedPos === filterKey
}

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
      { key: 'all-offense', label: 'All' },
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
      { key: 'all-defense', label: 'All' },
      { key: 'pressure', label: 'Pressure', note: 'TFL, QB Hits, Sacks' },
      { key: 'coverage', label: 'Coverage', note: 'Tackles, Assist Tackles, PDs' },
      { key: 'turnover', label: 'Turnover', note: 'FF, FR, INT, FR Yds, INT Ret Yds' },
      { key: 'defense-td', label: 'Touchdowns', note: 'Ranked by defensive TDs, not fantasy points' },
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

// Appended to every player-level (non-coaching) leaf's STAT_COLUMNS below --
// the snap-count column relevant to that leaf's side of the ball.
const OFFENSE_SNAPS_COL = { key: 'snaps', label: 'Snaps' }
const DEFENSE_SNAPS_COL = { key: 'snaps', label: 'Snaps' }
const SPECIAL_SNAPS_COL = { key: 'snaps', label: 'Snaps' }

// The underlying counting stats shown per leaf category -- these feed
// that category's fantasy points, per Fantasy Rules.
const STAT_COLUMNS = {
  'all-offense': [
    { key: 'purposeYds', label: 'Purpose Yds', note: 'Rush + receiving + return yards (not passing)' },
    { key: 'tgtPct', label: 'Tgt % Snaps', note: "Targets as a % of this player's own offense snaps" },
    { key: 'carryPct', label: 'Car % Snaps', note: "Carries as a % of this player's own offense snaps" },
    { key: 'teamTouchPct', label: 'Touch % Team', note: "Carries + targets as a % of the team's total offense snaps" },
    { key: 'offSnapPct', label: 'Off Snap %' },
    OFFENSE_SNAPS_COL,
  ],
  passing: [
    { key: 'comp', label: 'Comp' },
    { key: 'att', label: 'Att' },
    { key: 'yds', label: 'Yds' },
    { key: 'ydsPerComp', label: 'Yds/Comp' },
    { key: 'ydsPerAtt', label: 'Yds/Att' },
    { key: 'td', label: 'TD' },
    { key: 'int', label: 'INT' },
    { key: 'sacksAgainst', label: 'Sacks Against' },
    { key: 'qbHitsAgainst', label: 'QB Hits Against' },
    { key: 'rating', label: 'Rating' },
    OFFENSE_SNAPS_COL,
  ],
  receiving: [
    { key: 'rec', label: 'Rec' },
    { key: 'targets', label: 'Targets' },
    { key: 'yds', label: 'Yds' },
    { key: 'ydsPerTarget', label: 'Yds/Tgt' },
    { key: 'ydsPerRec', label: 'Yds/Rec' },
    { key: 'td', label: 'TD' },
    { key: 'tgtPct', label: 'Tgt % of Snaps' },
    OFFENSE_SNAPS_COL,
  ],
  rushing: [
    { key: 'att', label: 'Att' },
    { key: 'yds', label: 'Yds' },
    { key: 'ypc', label: 'Yds/Car' },
    { key: 'td', label: 'TD' },
    OFFENSE_SNAPS_COL,
  ],
  'blocking-bonus': [
    { key: 'avgPassComp', label: 'Avg/Comp' },
    { key: 'avgRush', label: 'Avg/Rush' },
    { key: 'rushAtt', label: 'Rush Att' },
    { key: 'avgRec', label: 'Avg/Rec' },
    OFFENSE_SNAPS_COL,
  ],
  'all-defense': [
    { key: 'tfl', label: 'TFL' },
    { key: 'qbHits', label: 'QB Hits' },
    { key: 'sacks', label: 'Sacks' },
    { key: 'tkl', label: 'Tackles' },
    { key: 'ast', label: 'Assists' },
    { key: 'pd', label: 'PD' },
    { key: 'ff', label: 'FF' },
    { key: 'fr', label: 'FR' },
    { key: 'int', label: 'INT' },
    { key: 'defTd', label: 'Def TD' },
    { key: 'defSnapPct', label: 'D-Sn %' },
    DEFENSE_SNAPS_COL,
  ],
  pressure: [
    { key: 'tfl', label: 'TFL' },
    { key: 'qbHits', label: 'QB Hits' },
    { key: 'sacks', label: 'Sacks' },
    { key: 'defSnapPct', label: 'D-Sn %' },
    DEFENSE_SNAPS_COL,
  ],
  coverage: [
    { key: 'tkl', label: 'Tackles' },
    { key: 'ast', label: 'Assists' },
    { key: 'pd', label: 'PD' },
    { key: 'defSnapPct', label: 'D-Sn %' },
    DEFENSE_SNAPS_COL,
  ],
  turnover: [
    { key: 'ff', label: 'FF' },
    { key: 'fr', label: 'FR' },
    { key: 'int', label: 'INT' },
    { key: 'frYds', label: 'FR Yds' },
    { key: 'intYds', label: 'INT Ret Yds' },
    { key: 'defSnapPct', label: 'D-Sn %' },
    DEFENSE_SNAPS_COL,
  ],
  'defense-td': [
    { key: 'defTd', label: 'Def TD' },
    { key: 'fumbleRetTd', label: 'Fumble Ret TD' },
    { key: 'defSnapPct', label: 'D-Sn %' },
    DEFENSE_SNAPS_COL,
  ],
  'coach-head': [
    { key: 'won', label: 'Won' },
    { key: 'lost', label: 'Lost' },
    { key: 'tied', label: 'Tied' },
    { key: 'ptDiff', label: 'Pt Diff' },
    { key: 'ydDiff', label: 'Yd Diff' },
    { key: 'offTd', label: 'Off TD' },
    { key: 'defTd', label: 'Def TD' },
    { key: 'stTd', label: 'ST TD' },
    { key: 'fgMade', label: 'FG Made' },
    { key: 'stYds', label: 'ST Yds' },
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
    { key: 'fg0_19', label: '0-19' },
    { key: 'fg20_29', label: '20-29' },
    { key: 'fg30_39', label: '30-39' },
    { key: 'fg40_49', label: '40-49' },
    { key: 'fg50_59', label: '50-59' },
    { key: 'fg60', label: '60+' },
    { key: 'fg70', label: '70+' },
    SPECIAL_SNAPS_COL,
  ],
  punting: [
    { key: 'punts', label: 'Punts' },
    { key: 'puntYds', label: 'Punt Yds' },
    { key: 'puntAvg', label: 'Punt Avg' },
    { key: 'in20', label: 'In 20' },
    { key: 'returnedPct', label: '% Returned' },
    SPECIAL_SNAPS_COL,
  ],
  returning: [
    { key: 'kr', label: 'KR' },
    { key: 'krYds', label: 'KR Yds' },
    { key: 'krAvg', label: 'KR Avg' },
    { key: 'pr', label: 'PR' },
    { key: 'prYds', label: 'PR Yds' },
    { key: 'prAvg', label: 'PR Avg' },
    { key: 'stTd', label: 'ST TD' },
    SPECIAL_SNAPS_COL,
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
  // Defense's total is already a real column (it's the sum of pressure/
  // coverage/turnover server-side); Offense has no equivalent combined
  // column, so 'all-offense' is computed client-side instead (see
  // offensePoints below) rather than looked up here.
  'all-defense': 'defense_points',
}
function offensePoints(fp) {
  // Summing already-rounded floats can reintroduce binary floating-point
  // drift (0.1 + 0.2 = 0.30000000000000004) -- round the sum itself, not
  // just what gets displayed downstream.
  return round2(
    Number(fp.passing_points ?? 0) + Number(fp.rushing_points ?? 0)
    + Number(fp.receiving_points ?? 0) + Number(fp.blocking_bonus_points ?? 0),
  )
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

function lastNameOnly(fullName) {
  const rest = fullName.split(' ').slice(1).join(' ')
  return rest || fullName
}

function round2(n) {
  if (n == null || Number.isNaN(n)) return null
  return Math.round(n * 100) / 100
}

// Display-only: whatever precision a value was computed/stored at (often
// hundredths), the table always shows at most one decimal place -- a
// plain integer count (TD, snaps, etc.) passes through unchanged so it
// doesn't grow a pointless ".0".
function fmt1(n) {
  if (n == null || typeof n !== 'number' || Number.isNaN(n)) return n
  return Number.isInteger(n) ? n : Math.round(n * 10) / 10
}

// Heat-map cell shading -- red (low) through yellow to green (high),
// scaled to wherever this value falls between the column's own min and
// max (computed only across whatever rows are actually on screen, so it
// re-centers with the Table Limit/Position filter rather than against the
// whole league). A semi-transparent overlay keeps text legible in both
// themes instead of a solid fill.
function heatColor(value, range) {
  if (value == null || typeof value !== 'number' || Number.isNaN(value) || !range || range.max === range.min) {
    return undefined
  }
  const t = Math.min(Math.max((value - range.min) / (range.max - range.min), 0), 1)
  return `hsla(${t * 120}, 75%, 45%, 0.32)`
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
const COL_WIDTHS = { logo: 52, name: 108, total: 64, avg: 60 }
const COL_LEFT = {
  logo: 0,
  name: COL_WIDTHS.logo,
  total: COL_WIDTHS.logo + COL_WIDTHS.name,
  avg: COL_WIDTHS.logo + COL_WIDTHS.name + COL_WIDTHS.total,
}
// Weeks only ever needs to fit a couple of digits; stat columns get
// progressively more room the fewer of them there are, so a label like
// "Assists" or "Pt Diff" fits on one line instead of wrapping.
function scrollColWidthFor(count, isWeeksTab) {
  if (isWeeksTab) return 48
  if (count <= 3) return 96
  if (count <= 4) return 84
  if (count <= 5) return 76
  return 68
}
const FROZEN_WIDTH = COL_LEFT.avg + COL_WIDTHS.avg
const FROZEN_TD = 'sticky z-10 bg-neutral-50 dark:bg-neutral-900'
// Header cells need their own sticky-top (row scroll) layer, and the
// frozen-column header cells need BOTH axes at once -- a higher z-index
// than either plain sticky-left body cells or plain sticky-top header
// cells so that corner never shows either scrolling past underneath it.
const HEADER_TH = 'sticky top-0 z-20 bg-neutral-50 dark:bg-neutral-900'
const FROZEN_HEADER_TD = 'sticky top-0 z-30 bg-neutral-50 dark:bg-neutral-900'
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

// One labeled row of toggles -- the label sits in a fixed-width column to
// its left so the four groups (Year/Table Limit/Table Type/Position) line
// up with each other regardless of how many buttons wrap onto a second line.
function ToggleGroupRow({ label, align = 'center', children }) {
  return (
    <div className={`mb-4 flex flex-wrap gap-2 ${align === 'start' ? 'items-start' : 'items-center'}`}>
      <span
        className={`w-24 shrink-0 text-xs font-semibold uppercase tracking-wide text-neutral-500 ${
          align === 'start' ? 'pt-1.5' : ''
        }`}
      >
        {label}
      </span>
      <div className="flex flex-1 flex-wrap gap-1.5">{children}</div>
    </div>
  )
}

export default function FantasyScoresPage() {
  const [heatMode, setHeatMode] = useState(false)
  const [season, setSeason] = useState(DEFAULT_SEASON)
  const [topKey, setTopKey] = useState('weeks')
  const [subKey, setSubKey] = useState(null)
  const [positionFilter, setPositionFilter] = useState('all')
  const [rowLimit, setRowLimit] = useState(DEFAULT_ROW_LIMIT)
  // Which column the currently-shown rows are re-sorted by -- null means
  // the default (Total, i.e. however `rows` was already ranked). Only ever
  // sorts most-to-least; there's no ascending mode.
  const [sortKey, setSortKey] = useState(null)
  const [players, setPlayers] = useState([])
  const [teams, setTeams] = useState([])
  const [fantasyPoints, setFantasyPoints] = useState([])
  const [gamePoints, setGamePoints] = useState([])
  const [offenseStats, setOffenseStats] = useState([])
  const [defenseStats, setDefenseStats] = useState([])
  const [specialStats, setSpecialStats] = useState([])
  const [teamFantasyPoints, setTeamFantasyPoints] = useState([])
  const [teamSeasonStats, setTeamSeasonStats] = useState([])
  const [snapCounts, setSnapCounts] = useState([])
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
      fetchAllRows(() => supabase.from('player_season_snap_counts').select('*').eq('season', season)),
    ]).then(([fp, gp, off, def, spec, tfp, tss, snaps]) => {
      if (cancelled) return
      setFantasyPoints(fp.data ?? [])
      setGamePoints(gp.data ?? [])
      setOffenseStats(off.data ?? [])
      setDefenseStats(def.data ?? [])
      setSpecialStats(spec.data ?? [])
      setTeamFantasyPoints(tfp.data ?? [])
      setTeamSeasonStats(tss.data ?? [])
      setSnapCounts(snaps.data ?? [])
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
        'receiving_tds', 'sacks_suffered',
      ]),
    [offenseStats],
  )
  const defenseByPlayer = useMemo(
    () =>
      sumByPlayer(defenseStats, [
        'def_tackles_for_loss', 'def_qb_hits', 'def_sacks', 'def_tackles_solo',
        'def_tackles_with_assist', 'def_pass_defended', 'def_fumbles_forced', 'fumble_recovery_opp',
        'def_interceptions', 'fumble_recovery_yards_opp', 'def_tds', 'fumble_recovery_tds',
      ]),
    [defenseStats],
  )
  const specialByPlayer = useMemo(
    () =>
      sumByPlayer(specialStats, [
        'fg_made', 'fg_att', 'pat_made', 'pt_att', 'pt_yards', 'kickoff_returns',
        'kickoff_return_yards', 'punt_returns', 'punt_return_yards', 'pt_inside_20', 'pt_returned',
        'special_teams_tds', 'fg_made_0_19', 'fg_made_20_29', 'fg_made_30_39', 'fg_made_40_49',
        'fg_made_50_59', 'fg_made_60_', 'fg_made_70_',
      ]),
    [specialStats],
  )
  const firstDownsByTeam = useMemo(
    () => sumByTeam(offenseStats, ['passing_first_downs', 'rushing_first_downs', 'receiving_first_downs']),
    [offenseStats],
  )
  const snapsByPlayer = useMemo(
    () => sumByPlayer(snapCounts, ['offense_snaps', 'defense_snaps', 'st_snaps']),
    [snapCounts],
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

  // Player's share of their team's total defensive snaps that season --
  // team_season_stats only stores a per-game average, so the season total
  // is reconstructed as avg * games_played (a small rounding approximation,
  // since the avg itself is already rounded).
  function defSnapPctFor(playerId, team) {
    const defSnaps = snapsByPlayer.get(playerId)?.defense_snaps
    const t = teamSeasonByAbbr.get(team)
    if (defSnaps == null || !t?.defense_snaps_avg || !t?.games_played) return null
    return round2((defSnaps / (t.defense_snaps_avg * t.games_played)) * 100)
  }

  // Same idea, offense side -- also used as the denominator for a team's
  // total offense snaps (teamOffenseSnapsFor) when computing a player's
  // touch share of the whole team's offensive plays.
  function teamOffenseSnapsFor(team) {
    const t = teamSeasonByAbbr.get(team)
    return t?.offense_snaps_avg && t?.games_played ? t.offense_snaps_avg * t.games_played : null
  }
  function offSnapPctFor(playerId, team) {
    const offSnaps = snapsByPlayer.get(playerId)?.offense_snaps
    const teamSnaps = teamOffenseSnapsFor(team)
    return offSnaps == null || !teamSnaps ? null : round2((offSnaps / teamSnaps) * 100)
  }

  // Standard NFL passer rating (not ESPN's QBR, which needs play-level win-
  // probability data nflverse doesn't publish) -- computed from the same
  // completions/attempts/yards/TD/INT totals already on hand.
  function passerRating(s) {
    if (!s.attempts) return null
    const a = Math.min(Math.max((s.completions / s.attempts - 0.3) * 5, 0), 2.375)
    const b = Math.min(Math.max((s.passing_yards / s.attempts - 3) * 0.25, 0), 2.375)
    const c = Math.min(Math.max((s.passing_tds / s.attempts) * 20, 0), 2.375)
    const d = Math.min(Math.max(2.375 - (s.passing_interceptions / s.attempts) * 25, 0), 2.375)
    return round2(((a + b + c + d) / 6) * 100)
  }

  function statValuesFor(category, playerId, team) {
    const offSnaps = snapsByPlayer.get(playerId)?.offense_snaps
    const defSnaps = snapsByPlayer.get(playerId)?.defense_snaps
    const stSnaps = snapsByPlayer.get(playerId)?.st_snaps
    const defSnapPct = defSnapPctFor(playerId, team)
    switch (category) {
      case 'all-offense': {
        const s = offenseByPlayer.get(playerId)
        const spec = specialByPlayer.get(playerId)
        const purposeYds =
          (s?.rushing_yards ?? 0) + (s?.receiving_yards ?? 0)
          + (spec?.kickoff_return_yards ?? 0) + (spec?.punt_return_yards ?? 0)
        const teamSnaps = teamOffenseSnapsFor(team)
        const touches = (s?.carries ?? 0) + (s?.targets ?? 0)
        return {
          purposeYds,
          tgtPct: s?.targets != null && offSnaps ? round2((s.targets / offSnaps) * 100) : null,
          carryPct: s?.carries != null && offSnaps ? round2((s.carries / offSnaps) * 100) : null,
          teamTouchPct: teamSnaps ? round2((touches / teamSnaps) * 100) : null,
          offSnapPct: offSnapPctFor(playerId, team),
          snaps: offSnaps,
        }
      }
      case 'passing': {
        const s = offenseByPlayer.get(playerId)
        if (!s) return null
        const teamStats = teamSeasonByAbbr.get(team)
        return {
          comp: s.completions, att: s.attempts, yds: s.passing_yards,
          ydsPerComp: s.completions ? round2(s.passing_yards / s.completions) : 0,
          ydsPerAtt: s.attempts ? round2(s.passing_yards / s.attempts) : 0,
          td: s.passing_tds, int: s.passing_interceptions,
          sacksAgainst: s.sacks_suffered, qbHitsAgainst: teamStats?.qb_hits_allowed ?? null,
          rating: passerRating(s), snaps: offSnaps,
        }
      }
      case 'receiving': {
        const s = offenseByPlayer.get(playerId)
        return (
          s && {
            rec: s.receptions, targets: s.targets, yds: s.receiving_yards,
            ydsPerTarget: s.targets ? round2(s.receiving_yards / s.targets) : 0,
            ydsPerRec: s.receptions ? round2(s.receiving_yards / s.receptions) : 0,
            td: s.receiving_tds,
            tgtPct: offSnaps ? round2((s.targets / offSnaps) * 100) : null,
            snaps: offSnaps,
          }
        )
      }
      case 'rushing': {
        const s = offenseByPlayer.get(playerId)
        return s && { att: s.carries, yds: s.rushing_yards, ypc: s.carries ? round2(s.rushing_yards / s.carries) : 0, td: s.rushing_tds, snaps: offSnaps }
      }
      case 'blocking-bonus': {
        const s = offenseByPlayer.get(playerId)
        if (!s) return null
        return {
          avgPassComp: s.completions ? round2(s.passing_yards / s.completions) : 0,
          avgRush: s.carries ? round2(s.rushing_yards / s.carries) : 0,
          rushAtt: s.carries,
          avgRec: s.receptions ? round2(s.receiving_yards / s.receptions) : 0,
          snaps: offSnaps,
        }
      }
      case 'all-defense': {
        const s = defenseByPlayer.get(playerId)
        return (
          s && {
            tfl: s.def_tackles_for_loss, qbHits: s.def_qb_hits, sacks: s.def_sacks,
            tkl: s.def_tackles_solo, ast: s.def_tackles_with_assist, pd: s.def_pass_defended,
            ff: s.def_fumbles_forced, fr: s.fumble_recovery_opp, int: s.def_interceptions,
            defTd: s.def_tds, defSnapPct, snaps: defSnaps,
          }
        )
      }
      case 'pressure': {
        const s = defenseByPlayer.get(playerId)
        return s && { tfl: s.def_tackles_for_loss, qbHits: s.def_qb_hits, sacks: s.def_sacks, defSnapPct, snaps: defSnaps }
      }
      case 'coverage': {
        const s = defenseByPlayer.get(playerId)
        return s && { tkl: s.def_tackles_solo, ast: s.def_tackles_with_assist, pd: s.def_pass_defended, defSnapPct, snaps: defSnaps }
      }
      case 'turnover': {
        const s = defenseByPlayer.get(playerId)
        return (
          s && {
            ff: s.def_fumbles_forced, fr: s.fumble_recovery_opp, int: s.def_interceptions,
            frYds: s.fumble_recovery_yards_opp, intYds: s.def_interception_yards, defSnapPct, snaps: defSnaps,
          }
        )
      }
      case 'defense-td': {
        const s = defenseByPlayer.get(playerId)
        return s && { defTd: s.def_tds, fumbleRetTd: s.fumble_recovery_tds, defSnapPct, snaps: defSnaps }
      }
      case 'kicking': {
        const s = specialByPlayer.get(playerId)
        return (
          s && {
            fgMade: s.fg_made, fgAtt: s.fg_att, xpMade: s.pat_made,
            fg0_19: s.fg_made_0_19, fg20_29: s.fg_made_20_29, fg30_39: s.fg_made_30_39,
            fg40_49: s.fg_made_40_49, fg50_59: s.fg_made_50_59, fg60: s.fg_made_60_, fg70: s.fg_made_70_,
            snaps: stSnaps,
          }
        )
      }
      case 'punting': {
        const s = specialByPlayer.get(playerId)
        return (
          s && {
            punts: s.pt_att, puntYds: s.pt_yards, puntAvg: s.pt_att ? round2(s.pt_yards / s.pt_att) : 0,
            in20: s.pt_inside_20, returnedPct: s.pt_att ? round2((s.pt_returned / s.pt_att) * 100) : 0,
            snaps: stSnaps,
          }
        )
      }
      case 'returning': {
        const s = specialByPlayer.get(playerId)
        return (
          s && {
            kr: s.kickoff_returns, krYds: s.kickoff_return_yards,
            krAvg: s.kickoff_returns ? round2(s.kickoff_return_yards / s.kickoff_returns) : 0,
            pr: s.punt_returns, prYds: s.punt_return_yards,
            prAvg: s.punt_returns ? round2(s.punt_return_yards / s.punt_returns) : 0,
            stTd: s.special_teams_tds, snaps: stSnaps,
          }
        )
      }
      case 'coach-head': {
        const t = teamSeasonByAbbr.get(team)
        if (!t) return null
        const yardsFor = (t.rush_yds_avg ?? 0) + (t.pass_yds_avg ?? 0)
        const yardsAgainst = (t.rush_yds_allowed_avg ?? 0) + (t.pass_yds_allowed_avg ?? 0)
        return {
          won: t.wins, lost: t.losses, tied: t.ties, ptDiff: t.point_diff,
          ydDiff: round2((yardsFor - yardsAgainst) * (t.games_played ?? 0)),
          offTd: (t.rush_td ?? 0) + (t.pass_td ?? 0), defTd: t.def_td, stTd: t.st_td, fgMade: t.fg_made,
          stYds: round2(((t.kick_return_yards_avg ?? 0) + (t.punt_return_yards_avg ?? 0)) * (t.games_played ?? 0)),
        }
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
            passYdsAllowed: round2(t.pass_yds_allowed_avg), rushYdsAllowed: round2(t.rush_yds_allowed_avg),
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

  // A column sort only makes sense for the columns actually on screen, and
  // the Position filter's own OPTIONS depend on the Table Type too (see
  // positionFiltersFor) -- both reset whenever the Table Type is changed
  // directly (selectTop/selectSub below). selectPositionFilter deliberately
  // does NOT go through those -- picking a team-role filter changes the
  // Table Type as a side effect of setting the filter, and resetting the
  // filter right back to 'all' in response would undo the click.
  function selectTop(key) {
    setTopKey(key)
    const cat = TOP_CATEGORIES.find((c) => c.key === key)
    setSubKey(cat.subs ? cat.subs[0].key : null)
    setSortKey(null)
    setPositionFilter('all')
  }

  function selectSub(key) {
    setSubKey(key)
    setSortKey(null)
    setPositionFilter('all')
  }

  // Head Coach/Team D/Team O don't exist as rows anywhere but the Coaching
  // tab -- picking one also jumps the Table Type toggles there, the same
  // way clicking a sub-toggle would, so the leaderboard underneath is
  // never just empty because the wrong tab happened to be showing.
  function selectPositionFilter(key) {
    setPositionFilter(key)
    setSortKey(null)
    if (TEAM_ROLE_FILTERS[key]) {
      setTopKey('coaching')
      setSubKey(TEAM_ROLE_FILTERS[key])
    }
  }

  // Full sorted leaderboard for the current Table Type -- NOT yet cut down
  // to the row limit, so the Position filter below can narrow within the
  // whole list instead of within whatever happened to already be in the
  // (much smaller) top slice.
  const rows = useMemo(() => {
    if (isWeeks) {
      return fantasyPoints
        .slice()
        .sort((a, b) => Number(b.total_points) - Number(a.total_points))
        .map((fp) => {
          const player = playersById.get(fp.player_id)
          return {
            key: fp.player_id,
            playerId: fp.player_id,
            name: player?.display_name ?? fp.player_id,
            position: player?.position ?? '—',
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
        .map((r) => ({
          key: r.team,
          name: teamsByAbbr.get(r.team)?.team_name ?? r.team,
          position: COACH_LABEL[activeSub],
          team: r.team,
          total: Number(r[col]),
          avg: Number(r[avgCol]),
          isTeam: true,
          statValues: statValuesFor(activeSub, null, r.team),
        }))
    }

    const col = POINTS_COLUMN[activeSub]
    // 'defense-td' ranks by raw defensive-TD count, not fantasy points --
    // called out explicitly in its sub note (see TOP_CATEGORIES above).
    const points =
      activeSub === 'all-offense' ? offensePoints
      : activeSub === 'defense-td' ? (fp) => Number(defenseByPlayer.get(fp.player_id)?.def_tds ?? 0)
      : (fp) => Number(fp[col])
    const usesRealColumn = activeSub !== 'all-offense' && activeSub !== 'defense-td'
    return fantasyPoints
      .filter((r) => (usesRealColumn ? r[col] != null && Number(r[col]) !== 0 : points(r) !== 0))
      .slice()
      .sort((a, b) => points(b) - points(a))
      .map((fp) => {
        const player = playersById.get(fp.player_id)
        const team = teamOf(fp.player_id) ?? '???'
        return {
          key: fp.player_id,
          playerId: fp.player_id,
          name: player?.display_name ?? fp.player_id,
          position: player?.position ?? '—',
          team,
          total: points(fp),
          avg: round2(points(fp) / Number(fp.games)),
          statValues: statValuesFor(activeSub, fp.player_id, team),
        }
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    isWeeks, isCoaching, activeSub, fantasyPoints, teamFantasyPoints, playersById, teamsByAbbr,
    offenseByPlayer, defenseByPlayer, specialByPlayer, teamSeasonByAbbr, firstDownsByTeam, snapsByPlayer,
  ])

  // A second filter dimension on top of whichever leaderboard is showing.
  // Team-role filters are kept in sync with Table Type by selectPositionFilter
  // above, so by the time positionFilter is e.g. 'TeamD', activeSub is
  // already 'coach-defense' and `rows` is already the right team list --
  // this just has to let it through (a stale mismatch could only happen if
  // the Table Type sub-toggle were clicked directly afterward).
  const filteredRows = useMemo(() => {
    if (positionFilter === 'all') return rows
    if (TEAM_ROLE_FILTERS[positionFilter]) {
      return isCoaching && activeSub === TEAM_ROLE_FILTERS[positionFilter] ? rows : []
    }
    if (isCoaching) return []
    return rows.filter((r) => matchesPositionFilter(positionFilter, positionGroup(r.position)))
  }, [rows, positionFilter, isCoaching, activeSub])

  const visibleRows = filteredRows.slice(0, rowLimit)

  // Re-sorts the already-decided set of rows (rank + position filter +
  // row limit all stay fixed) by whichever column was clicked -- always
  // most-to-least, never a toggle to ascending.
  function sortValueFor(row, key) {
    if (key === 'total') return row.total
    if (key === 'avg') return row.avg
    const raw = isWeeks ? weekScoresByPlayer.get(row.playerId)?.[key] : row.statValues?.[key]
    return raw == null ? -Infinity : Number(raw)
  }
  const displayRows = useMemo(() => {
    if (!sortKey) return visibleRows
    return [...visibleRows].sort((a, b) => sortValueFor(b, sortKey) - sortValueFor(a, sortKey))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleRows, sortKey, isWeeks, weekScoresByPlayer])

  const scrollColumns = isWeeks ? WEEKS.map((w) => ({ key: w, label: `${w}` })) : STAT_COLUMNS[activeSub]
  // Fewer columns means more room per column -- a 3-4 column stat table
  // (e.g. Pressure) can afford enough width for "Assists"/"Pt Diff" to sit
  // on one line, while the 18-column Weeks view just needs enough for a
  // couple of digits.
  const scrollColWidth = scrollColWidthFor(scrollColumns.length, isWeeks)
  // table-layout:fixed alone doesn't stop a <table> shrinking below the
  // sum of its declared column widths to fit its container -- an explicit
  // total width forces it, which is what makes the wrapper's
  // overflow-x-auto have real excess width to scroll.
  const tableWidth = FROZEN_WIDTH + scrollColWidth * scrollColumns.length

  // Per-column min/max for the heat map -- scoped to exactly the rows on
  // screen (after the row limit and position filter), so it re-centers
  // with them rather than against the whole league.
  const heatRanges = useMemo(() => {
    if (!heatMode) return {}
    const ranges = {}
    for (const key of ['total', 'avg', ...scrollColumns.map((c) => c.key)]) {
      let min = Infinity
      let max = -Infinity
      for (const row of displayRows) {
        const v = sortValueFor(row, key)
        if (!Number.isFinite(v)) continue
        if (v < min) min = v
        if (v > max) max = v
      }
      ranges[key] = min <= max ? { min, max } : null
    }
    return ranges
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heatMode, displayRows, scrollColumns])

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <h1 className="mb-2 text-2xl font-semibold text-neutral-900 dark:text-neutral-100">Fantasy Scores</h1>
      <p className="mb-4 max-w-2xl text-sm text-neutral-500">
        Top fantasy scorers among the legal roster positions, computed from real nflverse box scores using the{' '}
        <a href="#/rules" className="underline">
          Fantasy Rules
        </a>{' '}
        scoring formulas, including touchdown-length bonuses and individual blocked-kick credit from
        nflverse's play-by-play data. Refreshed automatically every night as new games are played -- two
        Defensive Coordinator items (opponent penalty first downs, opponent fourth-downs-failed) still
        aren't computable from the available data; see{' '}
        <code className="rounded bg-neutral-100 px-1 py-0.5 text-xs dark:bg-neutral-800">
          build_coach_fantasy_scores.py
        </code>{' '}
        for the exact list.
      </p>

      <div className="mb-4">
        <ToggleButton active={heatMode} onClick={() => setHeatMode((v) => !v)}>
          Heat
        </ToggleButton>
      </div>

      <ToggleGroupRow label="Year">
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
      </ToggleGroupRow>

      <ToggleGroupRow label="Table Limit">
        {ROW_LIMITS.map((n) => (
          <ToggleButton key={n} active={rowLimit === n} onClick={() => setRowLimit(n)}>
            {n}
          </ToggleButton>
        ))}
      </ToggleGroupRow>

      <ToggleGroupRow label="Table Type" align="start">
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap gap-1.5">
            {TOP_CATEGORIES.map((c) => (
              <ToggleButton key={c.key} active={topKey === c.key} onClick={() => selectTop(c.key)}>
                {c.label}
              </ToggleButton>
            ))}
          </div>
          {!isWeeks && (
            <div className="flex flex-wrap gap-1.5">
              {topCategory.subs.map((s) => (
                <ToggleButton key={s.key} active={activeSub === s.key} onClick={() => selectSub(s.key)} title={s.note}>
                  {s.label}
                </ToggleButton>
              ))}
            </div>
          )}
        </div>
      </ToggleGroupRow>

      <ToggleGroupRow label="Position">
        {positionFiltersFor(topKey, activeSub).map((p) => (
          <ToggleButton key={p.key} active={positionFilter === p.key} onClick={() => selectPositionFilter(p.key)}>
            {p.label}
          </ToggleButton>
        ))}
      </ToggleGroupRow>

      {loading ? (
        <LoadingSpinner />
      ) : (
        <div className="scrollbar-hide overflow-auto rounded-lg border border-neutral-200 dark:border-neutral-800" style={{ maxHeight: '70vh' }}>
          <table className="border-collapse text-sm" style={{ tableLayout: 'fixed', width: '100%', minWidth: tableWidth }}>
            <thead>
              <tr className="text-left text-neutral-500">
                <th className={`${FROZEN_HEADER_TD} border-b border-neutral-200 py-2 font-medium dark:border-neutral-800`} style={{ left: COL_LEFT.logo, width: COL_WIDTHS.logo }} />
                <th
                  className={`${FROZEN_HEADER_TD} border-b border-neutral-200 py-2 pr-2 font-medium dark:border-neutral-800`}
                  style={{ left: COL_LEFT.name, width: COL_WIDTHS.name }}
                >
                  Player
                </th>
                <th
                  className={`${FROZEN_HEADER_TD} cursor-pointer border-b border-neutral-200 px-2 py-2 text-right font-medium hover:text-neutral-900 dark:border-neutral-800 dark:hover:text-neutral-100`}
                  style={{ left: COL_LEFT.total, width: COL_WIDTHS.total }}
                  onClick={() => setSortKey('total')}
                >
                  Total{sortKey === 'total' ? ' ▾' : ''}
                </th>
                <th
                  className={`${FROZEN_HEADER_TD} cursor-pointer border-b border-neutral-200 px-2 py-2 text-right font-medium hover:text-neutral-900 dark:border-neutral-800 dark:hover:text-neutral-100`}
                  style={{ left: COL_LEFT.avg, width: COL_WIDTHS.avg, ...DIVIDER_STYLE }}
                  onClick={() => setSortKey('avg')}
                >
                  Avg{sortKey === 'avg' ? ' ▾' : ''}
                </th>
                {scrollColumns.map((col) => (
                  <th
                    key={col.key}
                    className={`${HEADER_TH} cursor-pointer border-b border-l border-neutral-200 px-2 py-2 text-right font-medium hover:text-neutral-900 dark:border-neutral-800 dark:hover:text-neutral-100`}
                    style={{ width: scrollColWidth }}
                    onClick={() => setSortKey(col.key)}
                  >
                    {col.label}{sortKey === col.key ? ' ▾' : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {displayRows.length === 0 && (
                <tr>
                  <td colSpan={4 + scrollColumns.length} className="py-6 text-center text-sm text-neutral-400">
                    {rows.length === 0
                      ? `No fantasy data yet for ${season} -- check back once games are played.`
                      : 'No players match this position filter here.'}
                  </td>
                </tr>
              )}
              {displayRows.map((r) => (
                <tr key={r.key} className="border-b border-neutral-100 dark:border-neutral-900">
                  <td className={`${FROZEN_TD} py-2 pl-2`} style={{ left: COL_LEFT.logo, width: COL_WIDTHS.logo }}>
                    <img
                      src={`${import.meta.env.BASE_URL}logos/${r.team}.png`}
                      alt={r.team}
                      className="h-6 w-6 object-contain"
                    />
                  </td>
                  <td className={`${FROZEN_TD} py-2 pr-2`} style={{ left: COL_LEFT.name, width: COL_WIDTHS.name }}>
                    <div className="flex min-w-0 items-baseline gap-1.5 truncate font-medium text-neutral-900 dark:text-neutral-100">
                      {r.isTeam ? (
                        <Link to={activeSub === 'coach-head' ? `/coach/${r.team}` : `/team/${r.team}`} className="truncate hover:underline">
                          {r.name}
                        </Link>
                      ) : (
                        <Link to={`/player/${r.playerId}`} className="truncate hover:underline">
                          {lastNameOnly(r.name)}
                        </Link>
                      )}
                      <span className="shrink-0 text-xs font-normal text-neutral-400">{r.position}</span>
                    </div>
                  </td>
                  <td
                    className={`${FROZEN_TD} px-2 py-2 text-right font-semibold tabular-nums text-neutral-900 dark:text-neutral-100`}
                    style={{ left: COL_LEFT.total, width: COL_WIDTHS.total, backgroundColor: heatMode ? heatColor(r.total, heatRanges.total) : undefined }}
                  >
                    {fmt1(r.total)}
                  </td>
                  <td
                    className={`${FROZEN_TD} px-2 py-2 text-right tabular-nums text-neutral-600 dark:text-neutral-400`}
                    style={{ left: COL_LEFT.avg, width: COL_WIDTHS.avg, ...DIVIDER_STYLE, backgroundColor: heatMode ? heatColor(r.avg, heatRanges.avg) : undefined }}
                  >
                    {fmt1(r.avg)}
                  </td>
                  {isWeeks
                    ? WEEKS.map((w) => (
                        <td
                          key={w}
                          className="border-l border-neutral-100 px-2 py-2 text-right tabular-nums text-neutral-600 dark:border-neutral-900 dark:text-neutral-400"
                          style={{ backgroundColor: heatMode ? heatColor(weekScoresByPlayer.get(r.playerId)?.[w], heatRanges[w]) : undefined }}
                        >
                          {fmt1(weekScoresByPlayer.get(r.playerId)?.[w]) ?? '—'}
                        </td>
                      ))
                    : scrollColumns.map((col) => (
                        <td
                          key={col.key}
                          className="border-l border-neutral-100 px-2 py-2 text-right tabular-nums text-neutral-600 dark:border-neutral-900 dark:text-neutral-400"
                          style={{ backgroundColor: heatMode ? heatColor(Number(r.statValues?.[col.key]), heatRanges[col.key]) : undefined }}
                        >
                          {fmt1(r.statValues?.[col.key]) ?? '—'}
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
