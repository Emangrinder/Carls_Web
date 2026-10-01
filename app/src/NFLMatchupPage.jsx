import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from './supabaseClient'
import { findCurrentWeek, kickoffMs } from './currentWeek'
import LoadingSpinner from './LoadingSpinner'

// Every column here is a single differential number -- whatever the
// opponent's season stats say they give up minus this team's own season
// rate (or, for the counting stats, per-game via games_played, since
// team_season_stats stores those as season sums rather than its own _avg
// column). Positive always means "the opponent typically gives up more of
// this than this team's own normal output" -- i.e. this matchup should
// push the team above their season average, which is the trend-spotting
// read this page is for. No sign-flipping per stat (e.g. TO/G, SKA/G), so
// the column stays a literal against-minus-for read throughout.
function perGame(row, key) {
  if (!row || !row.games_played) return null
  return row[key] / row.games_played
}

function diff(a, b) {
  if (a == null || b == null) return null
  return a - b
}

const OFFENSE_COLUMNS = [
  {
    key: 'pyd',
    label: 'PYd/G',
    title: 'Pass Yds Allowed/G (opponent) minus Pass Yds/G (this team)',
    value: (team, opp) => diff(opp.pass_yds_allowed_avg, team.pass_yds_avg),
  },
  {
    key: 'ryd',
    label: 'RYd/G',
    title: 'Rush Yds Allowed/G (opponent) minus Rush Yds/G (this team)',
    value: (team, opp) => diff(opp.rush_yds_allowed_avg, team.rush_yds_avg),
  },
  {
    key: 'cmp_g',
    label: 'CMP/G',
    title: 'Completions Allowed/G (opponent) minus Completions/G (this team)',
    value: (team, opp) => diff(opp.completions_allowed_avg, team.completions_avg),
  },
  {
    key: 'cmp',
    label: 'CMP%',
    title: "The opponent defense's completion % allowed minus this team's completion %",
    value: (team, opp) => diff(opp.comp_pct_against, team.comp_pct_for),
    isPct: true,
  },
  {
    key: 'ska',
    label: 'SKA/G',
    title: "Sacks/G (opponent's pass rush) minus Sacks Allowed/G (this team's O-line) -- positive is BAD here (more sacks taken than usual)",
    value: (team, opp) => diff(perGame(opp, 'sacks'), perGame(team, 'sacks_allowed')),
    invert: true,
  },
  {
    key: 'to',
    label: 'TO/G',
    title:
      "Takeaways/G (opponent's defense) minus Giveaways/G (this team's offense) -- positive is BAD here (more giveaways than usual)",
    value: (team, opp) =>
      diff(
        (perGame(opp, 'takeaways_int') ?? 0) + (perGame(opp, 'takeaways_fumble') ?? 0),
        (perGame(team, 'turnovers_int') ?? 0) + (perGame(team, 'turnovers_fumble') ?? 0),
      ),
    invert: true,
  },
  {
    key: 'osnap',
    label: 'OSnp/G',
    title:
      "Defense Snaps/G (opponent's defensive workload, i.e. how many plays they typically face) minus Offense Snaps/G (this team's own offense) -- more is GOOD here (more plays run this week than usual)",
    value: (team, opp) => diff(opp.defense_snaps_avg, team.offense_snaps_avg),
  },
]

const DEFENSE_COLUMNS = [
  {
    key: 'sk',
    label: 'SK/G',
    title: "Sacks Allowed/G (opponent's O-line) minus Sacks/G (this team's defense)",
    value: (team, opp) => diff(perGame(opp, 'sacks_allowed'), perGame(team, 'sacks')),
  },
  {
    key: 'qbh',
    label: 'QBH/G',
    title: "QB Hits Allowed/G (opponent's offense) minus QB Hits/G (this team's defense)",
    value: (team, opp) => diff(perGame(opp, 'qb_hits_allowed'), perGame(team, 'qb_hits')),
  },
  {
    key: 'tfl',
    label: 'TFL/G',
    title: "TFL Allowed/G (opponent's offense) minus Tackles For Loss/G (this team's defense)",
    value: (team, opp) => diff(perGame(opp, 'tfl_allowed'), perGame(team, 'tfl')),
  },
  {
    key: 'int',
    label: 'INT/G',
    title: "Interceptions/G thrown (opponent's offense) minus Interceptions/G forced (this team's defense)",
    value: (team, opp) => diff(perGame(opp, 'turnovers_int'), perGame(team, 'def_ints')),
  },
  {
    key: 'pd',
    label: 'PD/A',
    title:
      "Passes Defended per 100 attempts suffered (opponent's QB) minus Passes Defended per 100 attempts forced (this team's defense)",
    value: (team, opp) => diff(opp.pd_suffered_pct, team.pd_forced_pct),
    isPct: true,
  },
  {
    key: 'btkv',
    label: 'BTK',
    title:
      "Broken-tackle vulnerability: the opponent's Broken Tackles/G × this team's own missed-tackle rate (missed tackles as a % of tackle attempts). Not a for-minus-against differential -- always >= 0, and more is bad (more exposed to broken tackles).",
    value: (team, opp) => {
      if (opp.broken_tackles_avg == null || team.missed_tackles_avg == null || !team.tackles_avg) return null
      return opp.broken_tackles_avg * (team.missed_tackles_avg / team.tackles_avg)
    },
    vulnerability: true,
    unsigned: true,
  },
  {
    key: 'dsnap',
    label: 'DSnp/G',
    title:
      "Offense Snaps/G (opponent's offensive pace/volume) minus Defense Snaps/G (this team's own defense) -- positive is BAD here (this team's defense facing more plays than usual)",
    value: (team, opp) => diff(opp.offense_snaps_avg, team.defense_snaps_avg),
    invert: true,
  },
]

// Returns are neither this team's offense nor its defense -- their own
// group rather than folded into either.
const SPECIAL_TEAMS_COLUMNS = [
  {
    key: 'kr',
    label: 'KR Yd/G',
    title: "Kick Return Yds Allowed/G (opponent's coverage unit) minus Kick Return Yds/G (this team)",
    value: (team, opp) => diff(opp.kick_return_yards_allowed_avg, team.kick_return_yards_avg),
  },
  {
    key: 'pr',
    label: 'PR Yd/G',
    title: "Punt Return Yds Allowed/G (opponent's coverage unit) minus Punt Return Yds/G (this team)",
    value: (team, opp) => diff(opp.punt_return_yards_allowed_avg, team.punt_return_yards_avg),
  },
  {
    key: 'punts',
    label: 'Punts/G',
    title:
      "Punts Allowed/G (opponent's defense, i.e. how often teams facing them punt) minus Punts/G (this team's own offense) -- positive is BAD here (this team punting more than usual means their offense is stalling more than normal)",
    value: (team, opp) => diff(opp.punts_allowed_avg, team.punts_avg),
    invert: true,
  },
  {
    key: 'prpct',
    label: 'PR%',
    // punt_return_pct_for/_against are named backwards from every other
    // _for/_against pair in this schema (see the comment on TeamPage.jsx's
    // STAT_ROWS) -- _for is really "how often THIS team's own punts get
    // returned against them" (a coverage-vulnerability read on opp here),
    // and _against is really "this team's own punt-return success rate".
    title:
      "Opponent's punt coverage vulnerability (how often opponent's own punts get returned against them) minus this team's own punt-return rate",
    value: (team, opp) => diff(opp.punt_return_pct_for, team.punt_return_pct_against),
    isPct: true,
  },
]

const ALL_COLUMNS = [...OFFENSE_COLUMNS, ...DEFENSE_COLUMNS, ...SPECIAL_TEAMS_COLUMNS]

function sumValues(...vals) {
  if (vals.some((v) => v == null || Number.isNaN(v))) return null
  return vals.reduce((a, b) => a + b, 0)
}

const pydCol = OFFENSE_COLUMNS.find((c) => c.key === 'pyd')
const rydCol = OFFENSE_COLUMNS.find((c) => c.key === 'ryd')
const cmpCol = OFFENSE_COLUMNS.find((c) => c.key === 'cmp')
const skaCol = OFFENSE_COLUMNS.find((c) => c.key === 'ska')
const toCol = OFFENSE_COLUMNS.find((c) => c.key === 'to')
const osnapCol = OFFENSE_COLUMNS.find((c) => c.key === 'osnap')
const skCol = DEFENSE_COLUMNS.find((c) => c.key === 'sk')
const qbhCol = DEFENSE_COLUMNS.find((c) => c.key === 'qbh')
const intCol = DEFENSE_COLUMNS.find((c) => c.key === 'int')
const pdCol = DEFENSE_COLUMNS.find((c) => c.key === 'pd')
const dsnapCol = DEFENSE_COLUMNS.find((c) => c.key === 'dsnap')

// The default (no group isolated) view condenses each group down to a
// handful of combined stats instead of every column at once -- each
// combined one's `value` just re-adds two of the full table's own
// columns (same source of truth as the toggled-open view, not a
// separately maintained formula) so the two never drift out of sync.
const OFFENSE_SUMMARY_COLUMNS = [
  osnapCol,
  {
    key: 'totyd',
    label: 'Tot Yd/G',
    title: "Combined Pass Yds/G + Rush Yds/G differential (opponent allowed minus this team's own)",
    value: (team, opp) => sumValues(pydCol.value(team, opp), rydCol.value(team, opp)),
  },
  cmpCol,
  {
    key: 'oppd',
    label: 'Opp-D',
    title:
      "Combined Sacks Allowed/G + Turnovers/G differential -- positive is BAD (both halves already read that way before this sum)",
    value: (team, opp) => sumValues(skaCol.value(team, opp), toCol.value(team, opp)),
    invert: true,
  },
]

const DEFENSE_SUMMARY_COLUMNS = [
  dsnapCol,
  {
    key: 'pressure',
    label: 'Pressure/G',
    title: 'Combined Sacks/G + QB Hits/G differential',
    value: (team, opp) => sumValues(skCol.value(team, opp), qbhCol.value(team, opp)),
  },
  {
    key: 'coverage',
    label: 'Coverage',
    // PD/A is a per-100-attempts rate and INT/G is a per-game count --
    // different units added together, per request, not a unit mistake.
    title: 'Combined Passes Defended rate + Interceptions/G differential',
    value: (team, opp) => sumValues(pdCol.value(team, opp), intCol.value(team, opp)),
  },
]

const SUMMARY_COLUMNS = [...OFFENSE_SUMMARY_COLUMNS, ...DEFENSE_SUMMARY_COLUMNS, ...SPECIAL_TEAMS_COLUMNS]
const SUMMARY_ONLY_COLUMNS = [
  OFFENSE_SUMMARY_COLUMNS.find((c) => c.key === 'totyd'),
  OFFENSE_SUMMARY_COLUMNS.find((c) => c.key === 'oppd'),
  DEFENSE_SUMMARY_COLUMNS.find((c) => c.key === 'pressure'),
  DEFENSE_SUMMARY_COLUMNS.find((c) => c.key === 'coverage'),
]

// The three collapsible groups, keyed for the activeGroup/groupSortMode
// state below -- clicking a group header isolates it (hiding the other
// two entirely, not just visually fading them, to actually reclaim the
// space), showing its FULL column set (unchanged from before), and cycles
// through sorting rows by that group's own green/red count on repeat
// clicks of the SAME group; clicking a different group switches which one
// is isolated and resets the sort back to plain. With nothing isolated,
// each group instead shows its condensed summaryColumns.
const GROUPS = {
  offense: { label: 'Offense', columns: OFFENSE_COLUMNS, summaryColumns: OFFENSE_SUMMARY_COLUMNS },
  defense: { label: 'Defense', columns: DEFENSE_COLUMNS, summaryColumns: DEFENSE_SUMMARY_COLUMNS },
  specialTeams: { label: 'Special Teams', columns: SPECIAL_TEAMS_COLUMNS, summaryColumns: SPECIAL_TEAMS_COLUMNS },
}

// Index (within SUMMARY_COLUMNS) where the Defense and Special Teams
// groups each start -- used to draw a divider on just that column's
// leading edge, visually separating the three stat groups as you scan
// across the row. Only meaningful in the default (nothing isolated) view,
// since a single isolated group has nothing adjacent to divide from.
const SUMMARY_DEFENSE_START = OFFENSE_SUMMARY_COLUMNS.length
const SUMMARY_SPECIAL_START = OFFENSE_SUMMARY_COLUMNS.length + DEFENSE_SUMMARY_COLUMNS.length
const GROUP_DIVIDER = 'border-l-2 border-neutral-300 dark:border-neutral-700'

function groupStartBorder(col, isolated) {
  if (isolated) return ''
  const index = SUMMARY_COLUMNS.indexOf(col)
  return index === SUMMARY_DEFENSE_START || index === SUMMARY_SPECIAL_START ? GROUP_DIVIDER : ''
}

// +1 green / -1 red / 0 neither, matching exactly what diffColor/vulnColor
// would render for this cell -- the shared source of truth for both the
// cell's own color and the group-level green/red row counts below.
function columnSentiment(col, teamStats, oppStats) {
  const v = col.value(teamStats, oppStats)
  if (v == null || Number.isNaN(v)) return 0
  if (col.vulnerability) return v !== 0 ? -1 : 0
  const colorValue = col.invert ? -v : v
  if (colorValue > 0) return 1
  if (colorValue < 0) return -1
  return 0
}

function fmtDiff(n, isPct, unsigned) {
  if (n == null || Number.isNaN(n)) return '—'
  const sign = !unsigned && n > 0 ? '+' : ''
  return `${sign}${n.toFixed(1)}${isPct ? '%' : ''}`
}

function diffColor(n) {
  if (n == null || Number.isNaN(n)) return 'text-neutral-400 dark:text-neutral-600'
  if (n > 0) return 'text-green-600 dark:text-green-400'
  if (n < 0) return 'text-red-600 dark:text-red-400'
  return 'text-neutral-500'
}

// A "vulnerability index" isn't a for-minus-against differential -- it's
// always >= 0 (a product of non-negative rates), and there's no favorable
// direction to show in green: more always means more exposed. Single red
// hue, still opacity-scaled by diffOpacity like every other column, just
// never green.
function vulnColor(n) {
  if (n == null || Number.isNaN(n)) return 'text-neutral-400 dark:text-neutral-600'
  return 'text-red-600 dark:text-red-400'
}

// Intensity scales with |value| relative to the largest |value| in that
// same column this week, not some fixed constant -- a column whose week is
// mostly tight games looks mostly faded, one with a blowout differential
// still shows that outlier at full strength, and every column reads on its
// own scale (PYd/G's typical swing is nothing like CMP%'s). Opacity, not a
// second color, so the existing green/red/dark-mode classes from
// diffColor keep doing the hue -- this just fades toward the page
// background instead of toward a hardcoded gray that wouldn't match both
// themes.
const MIN_OPACITY = 0.35

function diffOpacity(n, maxAbs) {
  if (n == null || Number.isNaN(n) || !maxAbs) return 1
  const intensity = Math.min(Math.abs(n) / maxAbs, 1)
  return MIN_OPACITY + (1 - MIN_OPACITY) * intensity
}

// Team and Opp are the two frozen columns -- each one's sticky `left` has
// to equal the cumulative width of the frozen columns before it exactly,
// so both are fixed (not just min-width) rather than left to content-
// driven sizing. VS sits between them at rest but isn't sticky itself --
// scrolling right slides it out of view behind Team while Opp snaps left
// to sit flush against Team (sticky left: TEAM_COL_WIDTH, not
// TEAM_COL_WIDTH + VS_COL_WIDTH), so it collapses away instead of leaving
// a permanent gap in the frozen block.
const TEAM_COL_WIDTH = 48
const VS_COL_WIDTH = 28
const OPP_COL_WIDTH = 48
const STICKY_CELL = 'sticky z-10 bg-neutral-50 dark:bg-neutral-900'

function TeamCell({ abbr }) {
  return (
    <Link to={`/team/${abbr}`} className="flex items-center justify-center">
      <img
        src={`${import.meta.env.BASE_URL}logos/${abbr}.png`}
        alt={abbr}
        title={abbr}
        className="h-6 w-6 shrink-0 object-contain"
      />
    </Link>
  )
}

function VsCell({ opp }) {
  return <span className="text-xs text-neutral-400">{opp.isHome ? 'vs' : '@'}</span>
}

function OppCell({ opp }) {
  return (
    <Link to={`/team/${opp.abbr}`} className="flex items-center justify-center">
      <img
        src={`${import.meta.env.BASE_URL}logos/${opp.abbr}.png`}
        alt={opp.abbr}
        title={opp.abbr}
        className="h-6 w-6 shrink-0 object-contain"
      />
    </Link>
  )
}

// Shows which phase of the click-cycle a group header is currently in --
// nothing when it's not the isolated group (or isolated with no sort yet),
// a green up-arrow for "most green stats first", red down-arrow for "most
// red stats first".
function GroupSortIndicator({ active, mode }) {
  if (!active || !mode) return null
  return (
    <span className={`ml-1 ${mode === 'green' ? 'text-green-500' : 'text-red-500'}`}>
      {mode === 'green' ? '▲' : '▼'}
    </span>
  )
}

function fmtKickoff(gameday, gametime) {
  if (!gameday) return 'TBD'
  const dateStr = new Date(`${gameday}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
  if (!gametime) return dateStr
  const [h, m] = gametime.split(':').map(Number)
  if (Number.isNaN(h)) return dateStr
  const timeStr = new Date(2000, 0, 1, h, m).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return `${dateStr} · ${timeStr}`
}

// games.spread_line is always from the HOME team's perspective (positive =
// home favored -- see the same convention already documented in
// TeamRibbon.jsx's spreadGradient). Each row here is one team, home or
// away, so it has to be flipped for the away row to read as "this team's
// own spread" rather than always the home team's.
function teamSpread(spreadLine, isHome) {
  if (spreadLine == null) return null
  return isHome ? spreadLine : -spreadLine
}

function fmtSpread(n) {
  if (n == null) return '—'
  return n > 0 ? `+${n}` : `${n}`
}

export default function NFLMatchupPage() {
  const [current, setCurrent] = useState(null)
  const [games, setGames] = useState([])
  const [statsByTeam, setStatsByTeam] = useState(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [sortKey, setSortKey] = useState('kickoff')
  const [sortDir, setSortDir] = useState('asc')
  // null | 'offense' | 'defense' | 'specialTeams' -- which group (if any)
  // is isolated right now, collapsing the other two away entirely.
  const [activeGroup, setActiveGroup] = useState(null)
  // null | 'green' | 'red' -- only meaningful while activeGroup is set.
  const [groupSortMode, setGroupSortMode] = useState(null)

  // Find the current (season, week) the same way MatchesPage/TeamRibbon do.
  useEffect(() => {
    let cancelled = false
    supabase
      .from('games')
      .select('season, week, gameday, gametime')
      .eq('game_type', 'REG')
      .not('gameday', 'is', null)
      .then(({ data, error }) => {
        if (cancelled || error || !data || data.length === 0) return
        setCurrent(findCurrentWeek(data))
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!current) return
    let cancelled = false
    setLoading(true)
    setError(null)

    Promise.all([
      supabase
        .from('games')
        .select('*')
        .eq('season', current.season)
        .eq('game_type', 'REG')
        .eq('week', current.week),
      supabase.from('team_season_stats').select('*').eq('season', current.season),
      // CMP/G and PD/A aren't columns on team_season_stats -- team_game_stats
      // already carries per-game completions and attempts (granted to anon
      // since 0006_defense_scores_share_stats.sql), so both are derived here
      // instead of adding new columns. Summing across every team_game_stats
      // row (not just played ones) is safe -- an unplayed game's stats are
      // already 0, same reasoning as 0015's comment.
      supabase
        .from('team_game_stats')
        .select('team, opponent_team, completions, attempts')
        .eq('season', current.season)
        .eq('game_type', 'REG'),
    ]).then(([gamesRes, statsRes, gameStatsRes]) => {
      if (cancelled) return
      const err = gamesRes.error || statsRes.error || gameStatsRes.error
      if (err) {
        setError(err.message)
      } else {
        setGames(gamesRes.data)

        // completions/attempts "for" sum by team, "against" (allowed/faced)
        // sum by opponent_team -- team_game_stats.attempts is this row's
        // team's own pass attempts, so grouping by opponent_team gives the
        // attempt volume whoever played them (i.e. their defense) faced.
        const completionsFor = new Map()
        const completionsAgainst = new Map()
        const attemptsFor = new Map()
        const attemptsAgainst = new Map()
        for (const r of gameStatsRes.data) {
          completionsFor.set(r.team, (completionsFor.get(r.team) ?? 0) + (r.completions ?? 0))
          completionsAgainst.set(r.opponent_team, (completionsAgainst.get(r.opponent_team) ?? 0) + (r.completions ?? 0))
          attemptsFor.set(r.team, (attemptsFor.get(r.team) ?? 0) + (r.attempts ?? 0))
          attemptsAgainst.set(r.opponent_team, (attemptsAgainst.get(r.opponent_team) ?? 0) + (r.attempts ?? 0))
        }
        setStatsByTeam(
          new Map(
            statsRes.data.map((r) => {
              const gp = r.games_played
              const attFor = attemptsFor.get(r.team) ?? 0
              const attAgainst = attemptsAgainst.get(r.team) ?? 0
              return [
                r.team,
                {
                  ...r,
                  completions_avg: gp ? (completionsFor.get(r.team) ?? 0) / gp : null,
                  completions_allowed_avg: gp ? (completionsAgainst.get(r.team) ?? 0) / gp : null,
                  // Same formula 0016 used in SQL (100 * pass_defended /
                  // attempts faced), just computed client-side against
                  // pass_defended/pass_defended_allowed -- both pre-existing
                  // team_season_stats columns, untouched by the 0016 revert.
                  pd_forced_pct: attAgainst ? (100 * r.pass_defended) / attAgainst : null,
                  pd_suffered_pct: attFor ? (100 * r.pass_defended_allowed) / attFor : null,
                },
              ]
            }),
          ),
        )
      }
      setLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [current])

  // One row per team (32 for a full week) -- both the offense-vs-their-D
  // and defense-vs-their-O column groups live on that same row, keyed off
  // this team's own team_season_stats row vs. this week's opponent's.
  // Every scheduled game always gets both its rows, even when a team has
  // no team_season_stats row yet (e.g. week 1, before anyone has a
  // completed game for team_season_stats to aggregate) -- falling back to
  // {} rather than skipping the row means diff()/perGame() just render
  // "--" for that team instead of the whole matchup silently vanishing.
  const rows = useMemo(() => {
    const out = []
    for (const g of games) {
      const home = statsByTeam.get(g.home_team) ?? {}
      const away = statsByTeam.get(g.away_team) ?? {}
      out.push({ game: g, team: g.home_team, opp: { abbr: g.away_team, isHome: true }, teamStats: home, oppStats: away })
      out.push({ game: g, team: g.away_team, opp: { abbr: g.home_team, isHome: false }, teamStats: away, oppStats: home })
    }
    return out
  }, [games, statsByTeam])

  // Largest |value| per column across this week's 32 rows -- the
  // denominator diffOpacity scales against, recomputed only when the
  // underlying rows change (not on every sort/re-render).
  const columnScale = useMemo(() => {
    const scale = new Map()
    for (const c of [...ALL_COLUMNS, ...SUMMARY_ONLY_COLUMNS]) {
      let maxAbs = 0
      for (const r of rows) {
        const v = c.value(r.teamStats, r.oppStats)
        if (v != null && !Number.isNaN(v)) maxAbs = Math.max(maxAbs, Math.abs(v))
      }
      scale.set(c.key, maxAbs)
    }
    return scale
  }, [rows])

  // Isolating a group shows its FULL columns (other two groups' columns
  // disappear from the DOM entirely, not just hidden, to actually reclaim
  // the space); with nothing isolated, every group shows its condensed
  // summaryColumns instead.
  const visibleColumns = activeGroup ? GROUPS[activeGroup].columns : SUMMARY_COLUMNS

  const sortedRows = useMemo(() => {
    // A second click on the already-isolated group's header sorts by how
    // many of ITS OWN columns read green (then red on a third click)
    // instead of the normal single-column sort -- a quick "which matchups
    // favor this unit the most" read across the whole group at once.
    if (activeGroup && groupSortMode) {
      const cols = GROUPS[activeGroup].columns
      const withCount = rows.map((r) => {
        let green = 0
        let red = 0
        for (const c of cols) {
          const s = columnSentiment(c, r.teamStats, r.oppStats)
          if (s > 0) green++
          else if (s < 0) red++
        }
        return { r, count: groupSortMode === 'green' ? green : red }
      })
      withCount.sort((a, b) => b.count - a.count)
      return withCount.map((x) => x.r)
    }

    const getValue = (r) => {
      if (sortKey === 'kickoff') return kickoffMs(r.game)
      if (sortKey === 'spread') return teamSpread(r.game.spread_line, r.opp.isHome)
      if (sortKey === 'team') return r.team
      // visibleColumns, not ALL_COLUMNS -- sortKey can only ever be a key
      // that was actually clickable, which depends on summary vs. isolated.
      const col = visibleColumns.find((c) => c.key === sortKey)
      return col ? col.value(r.teamStats, r.oppStats) : null
    }
    return [...rows].sort((a, b) => {
      const va = getValue(a)
      const vb = getValue(b)
      let result
      if (typeof va === 'string' || typeof vb === 'string') {
        result = String(va ?? '').localeCompare(String(vb ?? ''))
      } else {
        result = (va ?? -Infinity) - (vb ?? -Infinity)
      }
      return sortDir === 'asc' ? result : -result
    })
  }, [rows, sortKey, sortDir, activeGroup, groupSortMode])

  // Clicking a group not currently isolated switches to it (plain order).
  // Clicking the ALREADY-isolated group cycles plain -> green count ->
  // red count -> back to all three groups showing again.
  function handleGroupHeaderClick(group) {
    if (activeGroup !== group) {
      setActiveGroup(group)
      setGroupSortMode(null)
    } else if (groupSortMode === null) {
      setGroupSortMode('green')
    } else if (groupSortMode === 'green') {
      setGroupSortMode('red')
    } else {
      setActiveGroup(null)
      setGroupSortMode(null)
    }
  }

  // How many columns a group's own header <th> should colSpan -- its full
  // count while isolated, its condensed summary count otherwise.
  function headerColSpan(group) {
    return activeGroup === group ? GROUPS[group].columns.length : GROUPS[group].summaryColumns.length
  }

  function handleSort(key) {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir(key === 'kickoff' || key === 'team' ? 'asc' : 'desc')
    }
  }

  const thBase = 'cursor-pointer select-none hover:text-neutral-900 dark:hover:text-neutral-100'

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <h1 className="mb-1 text-2xl font-semibold text-neutral-900 dark:text-neutral-100">NFL Matchup</h1>
      <p className="mb-4 text-sm text-neutral-400">
        {current ? `${current.season} · Week ${current.week}` : ''} — each team's season-to-date offense and defense
        rates, net of what this week's opponent gives up.
      </p>

      {loading && <LoadingSpinner />}
      {error && <p className="text-sm text-red-500">Error: {error}</p>}

      {!loading && !error && (
        <>
          <div className="mb-3 flex gap-2">
            {Object.entries(GROUPS).map(([key, g]) => (
              <button
                key={key}
                type="button"
                onClick={() => handleGroupHeaderClick(key)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  activeGroup === key
                    ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900'
                    : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700'
                }`}
              >
                {g.label}
                <GroupSortIndicator active={activeGroup === key} mode={groupSortMode} />
              </button>
            ))}
          </div>
          <div className="overflow-auto">
          <table className="w-full min-w-[1100px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-neutral-500 dark:border-neutral-800">
                <th
                  className={`${thBase} ${STICKY_CELL} left-0 py-2 pr-2 font-medium`}
                  style={{ width: TEAM_COL_WIDTH }}
                  onClick={() => handleSort('team')}
                >
                  Team
                </th>
                <th style={{ width: VS_COL_WIDTH }}></th>
                <th
                  className={`${STICKY_CELL} px-2 py-2 text-left font-medium`}
                  style={{ left: TEAM_COL_WIDTH, width: OPP_COL_WIDTH }}
                >
                  Opp
                </th>
                <th className={`${thBase} px-2 py-2 text-left font-medium`} onClick={() => handleSort('kickoff')}>
                  Kickoff
                </th>
                <th className={`${thBase} px-2 py-2 text-right font-medium`} onClick={() => handleSort('spread')}>
                  Spread
                </th>
                {(!activeGroup || activeGroup === 'offense') && (
                  <th
                    colSpan={headerColSpan('offense')}
                    className={`${thBase} px-2 py-2 text-center font-medium`}
                    onClick={() => handleGroupHeaderClick('offense')}
                  >
                    Offense
                    <GroupSortIndicator active={activeGroup === 'offense'} mode={groupSortMode} />
                  </th>
                )}
                {(!activeGroup || activeGroup === 'defense') && (
                  <th
                    colSpan={headerColSpan('defense')}
                    className={`${thBase} ${activeGroup ? '' : GROUP_DIVIDER} px-2 py-2 text-center font-medium`}
                    onClick={() => handleGroupHeaderClick('defense')}
                  >
                    Defense
                    <GroupSortIndicator active={activeGroup === 'defense'} mode={groupSortMode} />
                  </th>
                )}
                {(!activeGroup || activeGroup === 'specialTeams') && (
                  <th
                    colSpan={headerColSpan('specialTeams')}
                    className={`${thBase} ${activeGroup ? '' : GROUP_DIVIDER} px-2 py-2 text-center font-medium`}
                    onClick={() => handleGroupHeaderClick('specialTeams')}
                  >
                    Special Teams
                    <GroupSortIndicator active={activeGroup === 'specialTeams'} mode={groupSortMode} />
                  </th>
                )}
              </tr>
              <tr className="border-b border-neutral-200 text-left text-[11px] text-neutral-400 dark:border-neutral-800">
                <th className={`${STICKY_CELL} left-0`} style={{ width: TEAM_COL_WIDTH }}></th>
                <th style={{ width: VS_COL_WIDTH }}></th>
                <th className={STICKY_CELL} style={{ left: TEAM_COL_WIDTH, width: OPP_COL_WIDTH }}></th>
                <th></th>
                <th></th>
                {visibleColumns.map((c) => (
                  <th
                    key={c.key}
                    className={`${thBase} ${groupStartBorder(c, !!activeGroup)} px-2 pb-1 text-right font-normal`}
                    onClick={() => handleSort(c.key)}
                    title={c.title}
                  >
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((r) => (
                <tr key={`${r.game.game_id}-${r.team}`} className="border-b border-neutral-100 dark:border-neutral-900">
                  <td className={`${STICKY_CELL} left-0 py-2 pr-2`} style={{ width: TEAM_COL_WIDTH }}>
                    <TeamCell abbr={r.team} />
                  </td>
                  <td className="px-2 py-2 text-center" style={{ width: VS_COL_WIDTH }}>
                    <VsCell opp={r.opp} />
                  </td>
                  <td className={`${STICKY_CELL} px-2 py-2`} style={{ left: TEAM_COL_WIDTH, width: OPP_COL_WIDTH }}>
                    <OppCell opp={r.opp} />
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-xs text-neutral-400">
                    {fmtKickoff(r.game.gameday, r.game.gametime)}
                  </td>
                  <td className="px-2 py-2 text-right tabular-nums text-xs text-neutral-400">
                    {fmtSpread(teamSpread(r.game.spread_line, r.opp.isHome))}
                  </td>
                  {visibleColumns.map((c) => {
                    const v = c.value(r.teamStats, r.oppStats)
                    const colorValue = c.invert && v != null ? -v : v
                    const color = c.vulnerability ? vulnColor(v) : diffColor(colorValue)
                    return (
                      <td
                        key={c.key}
                        className={`${groupStartBorder(c, !!activeGroup)} px-2 py-2 text-right tabular-nums ${color}`}
                        style={{ opacity: diffOpacity(v, columnScale.get(c.key)) }}
                      >
                        {fmtDiff(v, c.isPct, c.unsigned)}
                      </td>
                    )
                  })}
                </tr>
              ))}
              {sortedRows.length === 0 && (
                <tr>
                  <td colSpan={5 + visibleColumns.length} className="py-6 text-center text-sm text-neutral-400">
                    No games scheduled this week.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          </div>
        </>
      )}
    </div>
  )
}
