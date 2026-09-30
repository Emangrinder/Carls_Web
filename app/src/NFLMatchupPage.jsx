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
    title: "Sacks/G (opponent's pass rush) minus Sacks Allowed/G (this team's O-line)",
    value: (team, opp) => diff(perGame(opp, 'sacks'), perGame(team, 'sacks_allowed')),
  },
  {
    key: 'to',
    label: 'TO/G',
    title: "Takeaways/G (opponent's defense) minus Giveaways/G (this team's offense)",
    value: (team, opp) =>
      diff(
        (perGame(opp, 'takeaways_int') ?? 0) + (perGame(opp, 'takeaways_fumble') ?? 0),
        (perGame(team, 'turnovers_int') ?? 0) + (perGame(team, 'turnovers_fumble') ?? 0),
      ),
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
]

const ALL_COLUMNS = [...OFFENSE_COLUMNS, ...DEFENSE_COLUMNS, ...SPECIAL_TEAMS_COLUMNS]

// Index (within ALL_COLUMNS) where the Defense and Special Teams groups
// each start -- used to draw a divider on just that column's leading edge,
// visually separating the three stat groups as you scan across the row.
const DEFENSE_START = OFFENSE_COLUMNS.length
const SPECIAL_TEAMS_START = OFFENSE_COLUMNS.length + DEFENSE_COLUMNS.length
const GROUP_DIVIDER = 'border-l-2 border-neutral-300 dark:border-neutral-700'

function groupStartBorder(index) {
  return index === DEFENSE_START || index === SPECIAL_TEAMS_START ? GROUP_DIVIDER : ''
}

function fmtDiff(n, isPct) {
  if (n == null || Number.isNaN(n)) return '—'
  const sign = n > 0 ? '+' : ''
  return `${sign}${n.toFixed(1)}${isPct ? '%' : ''}`
}

function diffColor(n) {
  if (n == null || Number.isNaN(n)) return 'text-neutral-400 dark:text-neutral-600'
  if (n > 0) return 'text-green-600 dark:text-green-400'
  if (n < 0) return 'text-red-600 dark:text-red-400'
  return 'text-neutral-500'
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

// Pixel widths for the two frozen leftmost columns -- Opp's sticky `left`
// has to equal Team's actual rendered width exactly, so both are fixed
// (not just min-width) rather than left to content-driven sizing.
const TEAM_COL_WIDTH = 96
const OPP_COL_WIDTH = 104
const STICKY_CELL = 'sticky z-10 bg-neutral-50 dark:bg-neutral-900'

function TeamCell({ abbr }) {
  return (
    <Link to={`/team/${abbr}`} className="flex items-center gap-2 hover:underline">
      <img
        src={`${import.meta.env.BASE_URL}logos/${abbr}.png`}
        alt={abbr}
        className="h-6 w-6 shrink-0 object-contain"
      />
      <span className="font-medium text-neutral-900 dark:text-neutral-100">{abbr}</span>
    </Link>
  )
}

function OppCell({ opp }) {
  return (
    <Link to={`/team/${opp.abbr}`} className="flex items-center gap-1.5 hover:underline">
      <span className="text-xs text-neutral-400">{opp.isHome ? 'vs' : '@'}</span>
      <img
        src={`${import.meta.env.BASE_URL}logos/${opp.abbr}.png`}
        alt={opp.abbr}
        className="h-6 w-6 shrink-0 object-contain"
      />
      <span className="text-sm text-neutral-500">{opp.abbr}</span>
    </Link>
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

export default function NFLMatchupPage() {
  const [current, setCurrent] = useState(null)
  const [games, setGames] = useState([])
  const [statsByTeam, setStatsByTeam] = useState(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [sortKey, setSortKey] = useState('kickoff')
  const [sortDir, setSortDir] = useState('asc')

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
    for (const c of ALL_COLUMNS) {
      let maxAbs = 0
      for (const r of rows) {
        const v = c.value(r.teamStats, r.oppStats)
        if (v != null && !Number.isNaN(v)) maxAbs = Math.max(maxAbs, Math.abs(v))
      }
      scale.set(c.key, maxAbs)
    }
    return scale
  }, [rows])

  const sortedRows = useMemo(() => {
    const getValue = (r) => {
      if (sortKey === 'kickoff') return kickoffMs(r.game)
      if (sortKey === 'team') return r.team
      const col = ALL_COLUMNS.find((c) => c.key === sortKey)
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
  }, [rows, sortKey, sortDir])

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
                <th
                  className={`${STICKY_CELL} px-2 py-2 text-left font-medium`}
                  style={{ left: TEAM_COL_WIDTH, width: OPP_COL_WIDTH }}
                >
                  Opp
                </th>
                <th className={`${thBase} px-2 py-2 text-left font-medium`} onClick={() => handleSort('kickoff')}>
                  Kickoff
                </th>
                <th colSpan={OFFENSE_COLUMNS.length} className="px-2 py-2 text-center font-medium">
                  Offense
                </th>
                <th colSpan={DEFENSE_COLUMNS.length} className={`${GROUP_DIVIDER} px-2 py-2 text-center font-medium`}>
                  Defense
                </th>
                <th colSpan={SPECIAL_TEAMS_COLUMNS.length} className={`${GROUP_DIVIDER} px-2 py-2 text-center font-medium`}>
                  Special Teams
                </th>
              </tr>
              <tr className="border-b border-neutral-200 text-left text-[11px] text-neutral-400 dark:border-neutral-800">
                <th className={`${STICKY_CELL} left-0`} style={{ width: TEAM_COL_WIDTH }}></th>
                <th className={STICKY_CELL} style={{ left: TEAM_COL_WIDTH, width: OPP_COL_WIDTH }}></th>
                <th></th>
                {ALL_COLUMNS.map((c, i) => (
                  <th
                    key={c.key}
                    className={`${thBase} ${groupStartBorder(i)} px-2 pb-1 text-right font-normal`}
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
                  <td className={`${STICKY_CELL} px-2 py-2`} style={{ left: TEAM_COL_WIDTH, width: OPP_COL_WIDTH }}>
                    <OppCell opp={r.opp} />
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-xs text-neutral-400">
                    {fmtKickoff(r.game.gameday, r.game.gametime)}
                  </td>
                  {ALL_COLUMNS.map((c, i) => {
                    const v = c.value(r.teamStats, r.oppStats)
                    return (
                      <td
                        key={c.key}
                        className={`${groupStartBorder(i)} px-2 py-2 text-right tabular-nums ${diffColor(v)}`}
                        style={{ opacity: diffOpacity(v, columnScale.get(c.key)) }}
                      >
                        {fmtDiff(v, c.isPct)}
                      </td>
                    )
                  })}
                </tr>
              ))}
              {sortedRows.length === 0 && (
                <tr>
                  <td colSpan={3 + ALL_COLUMNS.length} className="py-6 text-center text-sm text-neutral-400">
                    No games scheduled this week.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
