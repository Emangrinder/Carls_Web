import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from './supabaseClient'

const SEASONS = [2025, 2024]
const WEEKS = Array.from({ length: 18 }, (_, i) => i + 1)

function fmtDiff(n) {
  if (n == null) return '—'
  return n > 0 ? `+${n}` : `${n}`
}

function fmtAvg(n) {
  return n == null ? '—' : n.toFixed(1)
}

const STAT_ROWS = [
  { label: 'Rush Yds Avg', for: 'rush_yds_avg', against: 'rush_yds_allowed_avg', fmt: fmtAvg },
  { label: 'Pass Yds Avg', for: 'pass_yds_avg', against: 'pass_yds_allowed_avg', fmt: fmtAvg },
  { label: 'Interceptions', for: 'turnovers_int', against: 'takeaways_int', fmt: (n) => n ?? '—' },
  { label: 'Fumbles Lost', for: 'turnovers_fumble', against: 'takeaways_fumble', fmt: (n) => n ?? '—' },
  { label: 'Punts', for: 'punts', against: 'punts_allowed', fmt: (n) => n ?? '—' },
  { label: 'Rush TD', for: 'rush_td', against: 'rush_td_allowed', fmt: (n) => n ?? '—' },
  { label: 'Pass TD', for: 'pass_td', against: 'pass_td_allowed', fmt: (n) => n ?? '—' },
  { label: 'Kick Return Yds Avg', for: 'kick_return_yards_avg', against: 'kick_return_yards_allowed_avg', fmt: fmtAvg },
  { label: 'Punt Return Yds Avg', for: 'punt_return_yards_avg', against: 'punt_return_yards_allowed_avg', fmt: fmtAvg },
  { label: 'Offensive Snaps Avg', for: 'offense_snaps_avg', against: 'offense_snaps_allowed_avg', fmt: fmtAvg },
  { label: 'Defensive Snaps Avg', for: 'defense_snaps_avg', against: 'defense_snaps_allowed_avg', fmt: fmtAvg },
]

export default function TeamPage() {
  const { teamAbbr } = useParams()
  const [season, setSeason] = useState(SEASONS[0])
  const [team, setTeam] = useState(null)
  const [stats, setStats] = useState(null)
  const [depthChart, setDepthChart] = useState([])
  const [games, setGames] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    Promise.all([
      supabase.from('teams').select('*').eq('team_abbr', teamAbbr).single(),
      supabase.from('team_season_stats').select('*').eq('team', teamAbbr).eq('season', season).single(),
      supabase.from('depth_chart_ranks').select('*').eq('team', teamAbbr).order('position_group').order('rank'),
      supabase
        .from('games')
        .select('*')
        .eq('season', season)
        .or(`home_team.eq.${teamAbbr},away_team.eq.${teamAbbr}`)
        .order('week'),
    ]).then(([teamRes, statsRes, depthRes, gamesRes]) => {
      if (cancelled) return
      const err = teamRes.error || statsRes.error || depthRes.error || gamesRes.error
      if (err) {
        setError(err.message)
      } else {
        setTeam(teamRes.data)
        setStats(statsRes.data)
        setDepthChart(depthRes.data)
        setGames(gamesRes.data)
      }
      setLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [teamAbbr, season])

  if (loading) return <p className="p-6 text-sm text-neutral-500">Loading…</p>
  if (error) return <p className="p-6 text-sm text-red-500">Error: {error}</p>
  if (!team) return <p className="p-6 text-sm text-neutral-500">Team not found.</p>

  const gamesByWeek = new Map(games.map((g) => [g.week, g]))
  const depthByGroup = depthChart.reduce((acc, row) => {
    ;(acc[row.position_group] ??= []).push(row)
    return acc
  }, {})

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
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

      {/* Header: logo, name, conference/division, record */}
      <div className="mb-8 flex items-center gap-4">
        <img
          src={`${import.meta.env.BASE_URL}logos/${team.team_abbr}.png`}
          alt={team.team_abbr}
          className="h-20 w-20 object-contain"
        />
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
            {team.team_name}
          </h1>
          <p className="text-sm text-neutral-500">
            {team.conference} {team.division}
            {stats && (
              <>
                {' · '}
                {stats.wins}-{stats.losses}
                {stats.ties ? `-${stats.ties}` : ''} ({fmtDiff(stats.win_diff)})
              </>
            )}
          </p>
        </div>
      </div>

      {/* Schedule ribbon */}
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">
        Schedule
      </h2>
      <div className="mb-8 flex flex-wrap gap-2">
        {WEEKS.map((week) => {
          const g = gamesByWeek.get(week)
          if (!g) {
            return (
              <div key={week} className="flex flex-col items-center gap-1">
                <img
                  src={`${import.meta.env.BASE_URL}logos/NFL.png`}
                  alt="Bye"
                  className="h-8 w-8 object-contain opacity-50"
                />
                <span className="text-[10px] text-neutral-400">W{week}</span>
              </div>
            )
          }
          const isHome = g.home_team === teamAbbr
          const opponent = isHome ? g.away_team : g.home_team
          const teamScore = isHome ? g.home_score : g.away_score
          const oppScore = isHome ? g.away_score : g.home_score
          let result = null
          if (teamScore != null && oppScore != null) {
            result = teamScore > oppScore ? 'W' : teamScore < oppScore ? 'L' : 'T'
          }
          const resultColor =
            result === 'W'
              ? 'text-green-600 dark:text-green-400'
              : result === 'L'
                ? 'text-red-600 dark:text-red-400'
                : 'text-neutral-500'
          return (
            <div key={week} className="flex flex-col items-center gap-1">
              <img
                src={`${import.meta.env.BASE_URL}logos/${opponent}.png`}
                alt={opponent}
                className="h-8 w-8 object-contain"
              />
              <span className={`text-[10px] font-medium ${resultColor}`}>
                {result ?? '—'}
              </span>
            </div>
          )
        })}
      </div>

      {/* Season stats FOR/AGAINST */}
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">
        Season Stats
      </h2>
      <table className="mb-8 w-full max-w-md border-collapse text-sm">
        <thead>
          <tr className="border-b border-neutral-200 text-left text-neutral-500 dark:border-neutral-800">
            <th className="py-2 font-medium">Stat</th>
            <th className="px-2 py-2 text-right font-medium">For</th>
            <th className="px-2 py-2 text-right font-medium">Against</th>
          </tr>
        </thead>
        <tbody>
          {stats &&
            STAT_ROWS.map((row) => (
              <tr key={row.label} className="border-b border-neutral-100 dark:border-neutral-900">
                <td className="py-1.5 text-neutral-700 dark:text-neutral-300">{row.label}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{row.fmt(stats[row.for])}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{row.fmt(stats[row.against])}</td>
              </tr>
            ))}
        </tbody>
      </table>

      {/* Depth chart */}
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">
        Depth Chart
      </h2>
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {Object.entries(depthByGroup).map(([group, players]) => (
          <div key={group}>
            <h3 className="mb-1 text-xs font-semibold text-neutral-500">{group}</h3>
            <ul className="text-sm">
              {players.map((p) => (
                <li
                  key={`${p.position_name}-${p.position_slot}-${p.rank}`}
                  className="flex justify-between border-b border-neutral-100 py-1 dark:border-neutral-900"
                >
                  <span className="text-neutral-500">
                    {p.position_abbr} #{p.rank}
                  </span>
                  <span className="text-neutral-900 dark:text-neutral-100">
                    {p.player_name ?? '—'}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  )
}
