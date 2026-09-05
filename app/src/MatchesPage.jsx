import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from './supabaseClient'
import { CURRENT_TEAMS } from './constants'
import LoadingSpinner from './LoadingSpinner'

const SEASONS = [2026, 2025, 2024]
const DEFAULT_SEASON = 2025
const REG_WEEKS = Array.from({ length: 18 }, (_, i) => i + 1)
const POSTSEASON_TABS = [
  { gameType: 'WC', label: 'WC' },
  { gameType: 'DIV', label: 'DIV' },
  { gameType: 'CON', label: 'CONF' },
  { gameType: 'SB', label: 'SB' },
]

function fmtKickoffTime(gametime) {
  if (!gametime) return null
  const [h, m] = gametime.split(':').map(Number)
  if (Number.isNaN(h)) return null
  return new Date(2000, 0, 1, h, m).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function fmtDateHeader(gameday, weekday) {
  if (!gameday) return weekday || 'Date TBD'
  const dateStr = new Date(`${gameday}T00:00:00`).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
  return dateStr
}

function TeamSide({ abbr, name, score, isWinner, align }) {
  return (
    <Link
      to={`/team/${abbr}`}
      onClick={(e) => e.stopPropagation()}
      className={`flex min-w-0 flex-1 items-center gap-3 hover:underline ${
        align === 'right' ? 'flex-row-reverse text-right' : 'text-left'
      }`}
    >
      <img
        src={`${import.meta.env.BASE_URL}logos/${abbr}.png`}
        alt={abbr}
        className="h-9 w-9 shrink-0 object-contain"
      />
      <span className="hidden min-w-0 truncate sm:inline">
        <span
          className={`block text-sm font-medium ${
            isWinner
              ? 'text-neutral-900 dark:text-neutral-100'
              : 'text-neutral-500 dark:text-neutral-400'
          }`}
        >
          {name ?? abbr}
        </span>
      </span>
      {score != null && (
        <span
          className={`shrink-0 text-lg font-semibold tabular-nums ${
            isWinner ? 'text-neutral-900 dark:text-neutral-100' : 'text-neutral-400 dark:text-neutral-600'
          }`}
        >
          {score}
        </span>
      )}
    </Link>
  )
}

function MatchRow({ game, teamsByAbbr }) {
  const navigate = useNavigate()
  const played = game.home_score != null && game.away_score != null
  const homeWinner = played && game.home_score > game.away_score
  const awayWinner = played && game.away_score > game.home_score
  const kickoff = fmtKickoffTime(game.gametime)

  return (
    <div
      onClick={() => navigate(`/matches/${game.game_id}`)}
      className="mb-2 flex cursor-pointer items-center gap-4 rounded-lg border border-neutral-200 px-3 py-3 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900/60"
    >
      <div className="w-14 shrink-0 text-xs text-neutral-400">{kickoff ?? ''}</div>
      <TeamSide
        abbr={game.away_team}
        name={teamsByAbbr.get(game.away_team)?.team_name}
        score={game.away_score}
        isWinner={awayWinner || !played}
        align="left"
      />
      <span className="shrink-0 text-xs text-neutral-400">@</span>
      <TeamSide
        abbr={game.home_team}
        name={teamsByAbbr.get(game.home_team)?.team_name}
        score={game.home_score}
        isWinner={homeWinner || !played}
        align="right"
      />
      {!played && game.spread_line != null && (
        <div className="hidden w-20 shrink-0 text-right text-xs text-neutral-400 sm:block">
          Line {game.spread_line > 0 ? '+' : ''}
          {game.spread_line}
        </div>
      )}
    </div>
  )
}

export default function MatchesPage() {
  const [season, setSeason] = useState(DEFAULT_SEASON)
  const [tab, setTab] = useState({ kind: 'week', week: 1 })
  const [games, setGames] = useState([])
  const [teams, setTeams] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    Promise.all([
      supabase.from('games').select('*').eq('season', season),
      supabase.from('teams').select('team_abbr, team_name').in('team_abbr', CURRENT_TEAMS),
    ]).then(([gamesRes, teamsRes]) => {
      if (cancelled) return
      const err = gamesRes.error || teamsRes.error
      if (err) {
        setError(err.message)
      } else {
        setGames(gamesRes.data)
        setTeams(teamsRes.data)
      }
      setLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [season])

  const teamsByAbbr = useMemo(() => new Map(teams.map((t) => [t.team_abbr, t])), [teams])

  const shownGames = useMemo(() => {
    const filtered = games.filter((g) =>
      tab.kind === 'week' ? g.game_type === 'REG' && g.week === tab.week : g.game_type === tab.gameType,
    )
    return [...filtered].sort((a, b) => {
      const dateDiff = (a.gameday ?? '9999').localeCompare(b.gameday ?? '9999')
      if (dateDiff !== 0) return dateDiff
      return (a.gametime ?? '99:99').localeCompare(b.gametime ?? '99:99')
    })
  }, [games, tab])

  const gamesByDay = useMemo(() => {
    const groups = new Map()
    for (const g of shownGames) {
      const key = g.gameday ?? 'tbd'
      if (!groups.has(key)) groups.set(key, { gameday: g.gameday, weekday: g.weekday, games: [] })
      groups.get(key).games.push(g)
    }
    return [...groups.values()]
  }, [shownGames])

  const tabBase = 'shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors'
  const tabActive = 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900'
  const tabInactive =
    'bg-neutral-100 text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700'

  function isActive(candidate) {
    if (candidate.kind !== tab.kind) return false
    if (candidate.kind === 'week') return candidate.week === tab.week
    return candidate.gameType === tab.gameType
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6">
      <h1 className="mb-4 text-2xl font-semibold text-neutral-900 dark:text-neutral-100">Matches</h1>

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

      <div className="mb-2 flex flex-wrap gap-1.5">
        {REG_WEEKS.map((w) => (
          <button
            key={w}
            type="button"
            onClick={() => setTab({ kind: 'week', week: w })}
            className={`${tabBase} ${isActive({ kind: 'week', week: w }) ? tabActive : tabInactive}`}
          >
            {w}
          </button>
        ))}
      </div>
      <div className="mb-6 flex flex-wrap gap-1.5">
        {POSTSEASON_TABS.map((p) => (
          <button
            key={p.gameType}
            type="button"
            onClick={() => setTab({ kind: 'post', gameType: p.gameType })}
            className={`${tabBase} ${isActive({ kind: 'post', gameType: p.gameType }) ? tabActive : tabInactive}`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {loading && <LoadingSpinner />}
      {error && <p className="text-sm text-red-500">Error: {error}</p>}

      {!loading && !error && (
        <>
          {gamesByDay.length === 0 && (
            <p className="text-sm text-neutral-400">No games scheduled.</p>
          )}
          {gamesByDay.map((group) => (
            <div key={group.gameday ?? 'tbd'} className="mb-6">
              <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-400">
                {fmtDateHeader(group.gameday, group.weekday)}
              </h2>
              <div>
                {group.games.map((g) => (
                  <MatchRow key={g.game_id} game={g} teamsByAbbr={teamsByAbbr} />
                ))}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  )
}
