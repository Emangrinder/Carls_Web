import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from './supabaseClient'
import { findCurrentWeek, kickoffMs } from './currentWeek'
import LoadingSpinner from './LoadingSpinner'

// Every column here is a single differential number -- this team's own
// season rate minus whatever the opponent's season stats say they give up
// (or, for the two counting stats below, per-game via games_played, since
// team_season_stats stores those as season sums rather than its own _avg
// column). Positive always means "this team's own side of the ball did
// more of this than the opponent's numbers suggest is normal for them" --
// no sign-flipping for stats where more is normally bad (e.g. TO/G,
// SKA/G), so the column stays a literal for-minus-against read throughout.
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
    title: 'Pass Yds/G (this team) minus Pass Yds Allowed/G (opponent)',
    value: (team, opp) => diff(team.pass_yds_avg, opp.pass_yds_allowed_avg),
  },
  {
    key: 'ryd',
    label: 'RYd/G',
    title: 'Rush Yds/G (this team) minus Rush Yds Allowed/G (opponent)',
    value: (team, opp) => diff(team.rush_yds_avg, opp.rush_yds_allowed_avg),
  },
  {
    key: 'att',
    label: 'ATT/G',
    title: 'Pass Attempts/G (this team) minus Pass Attempts Allowed/G (opponent)',
    value: (team, opp) => diff(team.attempts_avg, opp.attempts_allowed_avg),
  },
  {
    key: 'cmp',
    label: 'CMP%',
    title: "This team's completion % minus the opponent defense's completion % allowed",
    value: (team, opp) => diff(team.comp_pct_for, opp.comp_pct_against),
    isPct: true,
  },
  {
    key: 'ska',
    label: 'SKA/G',
    title: "Sacks Allowed/G (this team's O-line) minus Sacks/G (opponent's pass rush)",
    value: (team, opp) => diff(perGame(team, 'sacks_allowed'), perGame(opp, 'sacks')),
  },
  {
    key: 'to',
    label: 'TO/G',
    title: "Giveaways/G (this team's offense) minus Takeaways/G (opponent's defense)",
    value: (team, opp) =>
      diff(
        (perGame(team, 'turnovers_int') ?? 0) + (perGame(team, 'turnovers_fumble') ?? 0),
        (perGame(opp, 'takeaways_int') ?? 0) + (perGame(opp, 'takeaways_fumble') ?? 0),
      ),
  },
]

const DEFENSE_COLUMNS = [
  {
    key: 'sk',
    label: 'SK/G',
    title: "Sacks/G (this team's defense) minus Sacks Allowed/G (opponent's O-line)",
    value: (team, opp) => diff(perGame(team, 'sacks'), perGame(opp, 'sacks_allowed')),
  },
  {
    key: 'qbh',
    label: 'QBH/G',
    title: "QB Hits/G (this team's defense) minus QB Hits Allowed/G (opponent's offense)",
    value: (team, opp) => diff(perGame(team, 'qb_hits'), perGame(opp, 'qb_hits_allowed')),
  },
  {
    key: 'tfl',
    label: 'TFL/G',
    title: "Tackles For Loss/G (this team's defense) minus TFL Allowed/G (opponent's offense)",
    value: (team, opp) => diff(perGame(team, 'tfl'), perGame(opp, 'tfl_allowed')),
  },
  {
    key: 'pd',
    label: 'PD/A',
    title:
      "Passes Defended per 100 attempts forced (this team's defense) minus Passes Defended per 100 attempts suffered (opponent's QB)",
    value: (team, opp) => diff(team.pd_forced_pct, opp.pd_suffered_pct),
    isPct: true,
  },
  {
    key: 'int',
    label: 'INT/G',
    title: "Interceptions/G forced (this team's defense) minus Interceptions/G thrown (opponent's offense)",
    value: (team, opp) => diff(perGame(team, 'def_ints'), perGame(opp, 'turnovers_int')),
  },
]

const ALL_COLUMNS = [...OFFENSE_COLUMNS, ...DEFENSE_COLUMNS]

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

function TeamAbbrCell({ abbr, opp }) {
  return (
    <Link to={`/team/${abbr}`} className="flex items-center gap-2 hover:underline">
      <img
        src={`${import.meta.env.BASE_URL}logos/${abbr}.png`}
        alt={abbr}
        className="h-6 w-6 shrink-0 object-contain"
      />
      <span className="font-medium text-neutral-900 dark:text-neutral-100">{abbr}</span>
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
    ]).then(([gamesRes, statsRes]) => {
      if (cancelled) return
      const err = gamesRes.error || statsRes.error
      if (err) {
        setError(err.message)
      } else {
        setGames(gamesRes.data)
        setStatsByTeam(new Map(statsRes.data.map((r) => [r.team, r])))
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
  const rows = useMemo(() => {
    const out = []
    for (const g of games) {
      const home = statsByTeam.get(g.home_team)
      const away = statsByTeam.get(g.away_team)
      if (home && away) {
        out.push({ game: g, team: g.home_team, opp: { abbr: g.away_team, isHome: true }, teamStats: home, oppStats: away })
        out.push({ game: g, team: g.away_team, opp: { abbr: g.home_team, isHome: false }, teamStats: away, oppStats: home })
      }
    }
    return out
  }, [games, statsByTeam])

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
                <th className={`${thBase} py-2 pr-2 font-medium`} onClick={() => handleSort('team')}>
                  Matchup
                </th>
                <th className={`${thBase} px-2 py-2 text-left font-medium`} onClick={() => handleSort('kickoff')}>
                  Kickoff
                </th>
                <th colSpan={OFFENSE_COLUMNS.length} className="px-2 py-2 text-center font-medium">
                  Offense
                </th>
                <th colSpan={DEFENSE_COLUMNS.length} className="px-2 py-2 text-center font-medium">
                  Defense
                </th>
              </tr>
              <tr className="border-b border-neutral-200 text-left text-[11px] text-neutral-400 dark:border-neutral-800">
                <th></th>
                <th></th>
                {ALL_COLUMNS.map((c) => (
                  <th
                    key={c.key}
                    className={`${thBase} px-2 pb-1 text-right font-normal`}
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
                  <td className="py-2 pr-2">
                    <TeamAbbrCell abbr={r.team} opp={r.opp} />
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-xs text-neutral-400">
                    {fmtKickoff(r.game.gameday, r.game.gametime)}
                  </td>
                  {ALL_COLUMNS.map((c) => {
                    const v = c.value(r.teamStats, r.oppStats)
                    return (
                      <td key={c.key} className={`px-2 py-2 text-right tabular-nums ${diffColor(v)}`}>
                        {fmtDiff(v, c.isPct)}
                      </td>
                    )
                  })}
                </tr>
              ))}
              {sortedRows.length === 0 && (
                <tr>
                  <td colSpan={2 + ALL_COLUMNS.length} className="py-6 text-center text-sm text-neutral-400">
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
