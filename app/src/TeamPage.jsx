import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from './supabaseClient'

const SEASONS = [2026, 2025, 2024]
const DEFAULT_SEASON = 2025
const WEEKS_PART1 = Array.from({ length: 9 }, (_, i) => i + 1) // 1-9
const WEEKS_PART2 = Array.from({ length: 9 }, (_, i) => i + 10) // 10-18
const POSTSEASON_LABELS = { WC: 'WC', DIV: 'DIV', CON: 'CONF', SB: 'SB' }

function fmtDiff(n) {
  if (n == null) return '—'
  return n > 0 ? `+${n}` : `${n}`
}

function fmtAvg(n) {
  return n == null ? '—' : n.toFixed(1)
}

function fmtPct(n) {
  return n == null ? '—' : `${n}%`
}

function fmtCount(n) {
  return n ?? '—'
}

// Each row renders its own For/Against pair from the full stats row, so a
// row can combine multiple underlying columns (e.g. interceptions+fumbles
// into one "Turnovers [I/F]" line) instead of always being one column each.
const STAT_ROWS = [
  { label: 'Rush Yds Avg', render: (s) => [fmtAvg(s.rush_yds_avg), fmtAvg(s.rush_yds_allowed_avg)] },
  { label: 'Pass Yds Avg', render: (s) => [fmtAvg(s.pass_yds_avg), fmtAvg(s.pass_yds_allowed_avg)] },
  {
    label: 'Turnovers [I/F]',
    render: (s) => [
      `${fmtCount(s.turnovers_int)}/${fmtCount(s.turnovers_fumble)}`,
      `${fmtCount(s.takeaways_int)}/${fmtCount(s.takeaways_fumble)}`,
    ],
  },
  {
    label: 'Pass/Rush TD',
    render: (s) => [
      `${fmtCount(s.pass_td)}/${fmtCount(s.rush_td)}`,
      `${fmtCount(s.pass_td_allowed)}/${fmtCount(s.rush_td_allowed)}`,
    ],
  },
  { label: 'Punts Avg', render: (s) => [fmtAvg(s.punts_avg), fmtAvg(s.punts_allowed_avg)] },
  { label: 'Punt Return %', render: (s) => [fmtPct(s.punt_return_pct_for), fmtPct(s.punt_return_pct_against)] },
  { label: 'Kick Return Yds Avg', render: (s) => [fmtAvg(s.kick_return_yards_avg), fmtAvg(s.kick_return_yards_allowed_avg)] },
  { label: 'Punt Return Yds Avg', render: (s) => [fmtAvg(s.punt_return_yards_avg), fmtAvg(s.punt_return_yards_allowed_avg)] },
  { label: 'Offensive Snaps Avg', render: (s) => [fmtAvg(s.offense_snaps_avg), fmtAvg(s.offense_snaps_allowed_avg)] },
  { label: 'Defensive Snaps Avg', render: (s) => [fmtAvg(s.defense_snaps_avg), fmtAvg(s.defense_snaps_allowed_avg)] },
]

// Maps a depth chart position_abbr to a stable category, independent of
// each team's own (inconsistently named) position_group formation labels.
const POSITION_CATEGORY = {
  QB: 'qb',
  LT: 'ol', LG: 'ol', C: 'ol', RG: 'ol', RT: 'ol',
  RB: 'skill', WR: 'skill', TE: 'skill', FB: 'skill',
  LDE: 'dl', RDE: 'dl', DE: 'dl', NT: 'dl', DT: 'dl',
  WLB: 'lb', SLB: 'lb', MLB: 'lb', LILB: 'lb', RILB: 'lb', ILB: 'lb', OLB: 'lb',
  LCB: 'cb', RCB: 'cb', CB: 'cb', NB: 'cb',
  FS: 's', SS: 's', S: 's',
  PK: 'st', P: 'st', KR: 'st', PR: 'st', LS: 'st', H: 'st',
}
const OL_ORDER = ['LT', 'LG', 'C', 'RG', 'RT']
const ST_STARTER_ABBRS = ['PK', 'P', 'KR', 'PR']
// Skill positions where more than one depth slot is part of the base
// personnel package, not just the #1 -- e.g. most offenses roll with 2+ WRs.
const SKILL_STARTER_MAX_RANK = { RB: 2, WR: 3, TE: 2, FB: 1 }
const SKILL_ORDER = ['RB', 'WR', 'TE', 'FB']

function categoryOf(p) {
  return POSITION_CATEGORY[p.position_abbr] ?? 'other'
}

function isSkillStarter(p) {
  const maxRank = SKILL_STARTER_MAX_RANK[p.position_abbr]
  return maxRank != null && p.rank <= maxRank
}

function PlayerChip({ p }) {
  return (
    <div className="shrink-0 whitespace-nowrap rounded border border-neutral-200 px-2 py-1 text-center text-xs dark:border-neutral-800">
      <div className="text-[10px] text-neutral-500">
        {p.position_abbr}
        {p.rank > 1 ? p.rank : ''}
      </div>
      <div className="font-medium text-neutral-900 dark:text-neutral-100">
        {p.player_name ?? '—'}
      </div>
    </div>
  )
}

function GameCell({ teamAbbr, game, byeLabel }) {
  if (!game) {
    return (
      <div className="flex flex-col items-center gap-1">
        <img
          src={`${import.meta.env.BASE_URL}logos/NFL.png`}
          alt="Bye"
          className="h-8 w-8 object-contain opacity-50"
        />
        <span className="text-[10px] text-neutral-400">{byeLabel}</span>
        <span className="text-[9px] text-transparent">@</span>
      </div>
    )
  }
  const isHome = game.home_team === teamAbbr
  const opponent = isHome ? game.away_team : game.home_team
  const teamScore = isHome ? game.home_score : game.away_score
  const oppScore = isHome ? game.away_score : game.home_score
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
    <div className="flex flex-col items-center gap-1">
      <img
        src={`${import.meta.env.BASE_URL}logos/${opponent}.png`}
        alt={opponent}
        className="h-8 w-8 object-contain"
      />
      <span className={`text-[10px] font-medium ${resultColor}`}>{result ?? '—'}</span>
      <span className="text-[9px] text-neutral-400">{isHome ? ' ' : '@'}</span>
    </div>
  )
}

function StarterRow({ label, players }) {
  if (players.length === 0) return null
  return (
    <div className="mb-2 flex items-center gap-2">
      <span className="w-24 shrink-0 text-xs text-neutral-500">{label}</span>
      <div className="flex flex-nowrap gap-2 overflow-x-auto">
        {players.map((p) => (
          <PlayerChip key={`${p.position_name}-${p.position_slot}-${p.rank}`} p={p} />
        ))}
      </div>
    </div>
  )
}

export default function TeamPage() {
  const { teamAbbr } = useParams()
  const [season, setSeason] = useState(DEFAULT_SEASON)
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
      supabase.from('team_season_stats').select('*').eq('team', teamAbbr).eq('season', season).maybeSingle(),
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

  const regGames = games.filter((g) => g.game_type === 'REG')
  const postGames = games
    .filter((g) => g.game_type !== 'REG')
    .sort((a, b) => a.week - b.week)
  const gamesByWeek = new Map(regGames.map((g) => [g.week, g]))

  // Starters: rank 1 within each recognized category, except skill
  // positions (RB/WR/TE) where several depth slots are all "starters".
  const rank1 = depthChart.filter((p) => p.rank === 1)
  const qbStarters = rank1.filter((p) => categoryOf(p) === 'qb')
  const olStarters = rank1
    .filter((p) => categoryOf(p) === 'ol')
    .sort((a, b) => OL_ORDER.indexOf(a.position_abbr) - OL_ORDER.indexOf(b.position_abbr))
  const skillStarters = depthChart
    .filter(isSkillStarter)
    .sort((a, b) => {
      const orderDiff = SKILL_ORDER.indexOf(a.position_abbr) - SKILL_ORDER.indexOf(b.position_abbr)
      return orderDiff !== 0 ? orderDiff : a.rank - b.rank
    })
  const dlStarters = rank1.filter((p) => categoryOf(p) === 'dl')
  const lbStarters = rank1.filter((p) => categoryOf(p) === 'lb')
  const cbStarters = rank1.filter((p) => categoryOf(p) === 'cb')
  const sStarters = rank1.filter((p) => categoryOf(p) === 's')
  const stStarters = rank1.filter((p) => ST_STARTER_ABBRS.includes(p.position_abbr))

  const shownInStarters = new Set([
    ...qbStarters, ...olStarters, ...skillStarters,
    ...dlStarters, ...lbStarters, ...cbStarters, ...sStarters,
    ...stStarters,
  ])
  const depthRest = depthChart.filter((p) => !shownInStarters.has(p))
  const depthByGroup = depthRest.reduce((acc, row) => {
    ;(acc[row.position_group] ??= []).push(row)
    return acc
  }, {})

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      {/* Header: logo, name, conference/division */}
      <div className="mb-4 flex items-center gap-4">
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
          </p>
        </div>
      </div>

      <div className="mb-8 flex gap-2">
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

      {/* Starters depth chart (left) + schedule/record/season stats (right) */}
      <div className="mb-8 flex flex-col gap-8 lg:flex-row">
        <div className="lg:w-[620px] lg:shrink-0">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">
            2026 Depth Chart
          </h2>

          <div className="mb-4">
            <h3 className="mb-1 text-xs font-bold uppercase text-neutral-400">Starting Offense</h3>
            <StarterRow label="QB" players={qbStarters} />
            <StarterRow label="Offensive Line" players={olStarters} />
            <StarterRow label="Skill" players={skillStarters} />
          </div>

          <div className="mb-4">
            <h3 className="mb-1 text-xs font-bold uppercase text-neutral-400">Starting Defense</h3>
            <StarterRow label="D-Line" players={dlStarters} />
            <StarterRow label="Linebackers" players={lbStarters} />
            <StarterRow label="Corners" players={cbStarters} />
            <StarterRow label="Safeties" players={sStarters} />
          </div>

          <div className="mb-2">
            <h3 className="mb-1 text-xs font-bold uppercase text-neutral-400">Special Teams</h3>
            <StarterRow label="Starters" players={stStarters} />
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">
            Schedule
          </h2>
          <div className="mb-2 flex flex-wrap gap-2">
            {WEEKS_PART1.map((week) => (
              <GameCell
                key={week}
                teamAbbr={teamAbbr}
                game={gamesByWeek.get(week)}
                byeLabel={`W${week}`}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {WEEKS_PART2.map((week) => (
              <GameCell
                key={week}
                teamAbbr={teamAbbr}
                game={gamesByWeek.get(week)}
                byeLabel={`W${week}`}
              />
            ))}
          </div>

          {postGames.length > 0 && (
            <>
              <h2 className="mb-2 mt-4 text-sm font-semibold uppercase tracking-wide text-neutral-500">
                Postseason
              </h2>
              <div className="flex flex-wrap gap-2">
                {postGames.map((g) => (
                  <GameCell
                    key={g.game_id}
                    teamAbbr={teamAbbr}
                    game={g}
                    byeLabel={POSTSEASON_LABELS[g.game_type] ?? g.game_type}
                  />
                ))}
              </div>
            </>
          )}

          {stats && (
            <p className="mb-2 mt-4 text-sm text-neutral-500">
              {stats.wins}-{stats.losses}
              {stats.ties ? `-${stats.ties}` : ''} ({fmtDiff(stats.win_diff)})
            </p>
          )}

          <h2 className="mb-2 mt-4 text-sm font-semibold uppercase tracking-wide text-neutral-500">
            Season Stats
          </h2>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-neutral-500 dark:border-neutral-800">
                <th className="py-2 font-medium">Stat</th>
                <th className="px-2 py-2 text-right font-medium">For</th>
                <th className="px-2 py-2 text-right font-medium">Against</th>
              </tr>
            </thead>
            <tbody>
              {stats ? (
                STAT_ROWS.map((row) => {
                  const [forVal, againstVal] = row.render(stats)
                  return (
                    <tr key={row.label} className="border-b border-neutral-100 dark:border-neutral-900">
                      <td className="py-1.5 text-neutral-700 dark:text-neutral-300">{row.label}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{forVal}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{againstVal}</td>
                    </tr>
                  )
                })
              ) : (
                <tr>
                  <td colSpan={3} className="py-4 text-center text-neutral-400">
                    No stats yet for {season}.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <h3 className="mb-2 text-xs font-bold uppercase text-neutral-400">Depth</h3>
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {Object.entries(depthByGroup).map(([group, players]) => (
          <div key={group}>
            <h4 className="mb-1 text-xs font-semibold text-neutral-500">{group}</h4>
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
