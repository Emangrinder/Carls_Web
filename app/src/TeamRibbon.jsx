import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from './supabaseClient'

function Logo({ team, className = '' }) {
  return (
    <img
      src={`${import.meta.env.BASE_URL}logos/${team}.png`}
      alt={team}
      className={`h-8 w-8 shrink-0 object-contain ${className}`}
    />
  )
}

function fmtKickoff(gameday, gametime) {
  if (!gameday) return 'Date TBD'
  const dateStr = new Date(`${gameday}T00:00:00`).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
  if (!gametime) return dateStr
  const [h, m] = gametime.split(':').map(Number)
  if (Number.isNaN(h)) return dateStr
  const timeStr = new Date(2000, 0, 1, h, m).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return `${dateStr} · ${timeStr}`
}

// Green on the favorite's side, red on the underdog's, intensity scaled to
// how big the spread is (a pick'em game gets almost no tint at all).
// spread_line is from the home team's perspective: positive = home favored.
function spreadGradient(spreadLine) {
  if (spreadLine == null) return {}
  const intensity = Math.min(Math.abs(spreadLine) / 14, 1)
  const alpha = 0.06 + intensity * 0.3
  const homeFavored = spreadLine > 0
  const awaySideColor = homeFavored ? `rgba(239,68,68,${alpha})` : `rgba(34,197,94,${alpha})`
  const homeSideColor = homeFavored ? `rgba(34,197,94,${alpha})` : `rgba(239,68,68,${alpha})`
  return { backgroundImage: `linear-gradient(to right, ${awaySideColor}, ${homeSideColor})` }
}

function GameTile({ game, className = '' }) {
  const played = game.home_score != null && game.away_score != null
  return (
    <Link
      to={`/matches/${game.game_id}`}
      style={spreadGradient(game.spread_line)}
      className={`flex shrink-0 flex-col items-center gap-1 rounded-md border border-neutral-200 px-3 py-1.5 hover:opacity-80 dark:border-neutral-800 ${className}`}
    >
      <div className="flex items-center gap-1.5 text-xs font-medium text-neutral-700 dark:text-neutral-300">
        <Logo team={game.away_team} />
        {played ? (
          <span className="tabular-nums">{game.away_score}</span>
        ) : null}
        <span className="text-neutral-400">@</span>
        <Logo team={game.home_team} />
        {played ? (
          <span className="tabular-nums">{game.home_score}</span>
        ) : null}
      </div>
      <div className="whitespace-nowrap text-[10px] text-neutral-500">
        {played ? 'Final' : fmtKickoff(game.gameday, game.gametime)}
      </div>
    </Link>
  )
}

export default function TeamRibbon() {
  const [games, setGames] = useState([])

  useEffect(() => {
    supabase
      .from('games')
      .select('*')
      .eq('game_type', 'REG')
      .not('gameday', 'is', null)
      .then(({ data, error }) => {
        if (error || !data || data.length === 0) return
        const kickoffMs = (g) => new Date(`${g.gameday}T${g.gametime || '13:00'}:00`).getTime()
        const now = Date.now()
        // "Current week" = whichever (season, week) has the game closest to
        // right now -- works whether that week is upcoming or just finished.
        let closest = data[0]
        let closestDiff = Infinity
        for (const g of data) {
          const diff = Math.abs(kickoffMs(g) - now)
          if (diff < closestDiff) {
            closestDiff = diff
            closest = g
          }
        }
        const weekGames = data
          .filter((g) => g.season === closest.season && g.week === closest.week)
          .sort((a, b) => kickoffMs(a) - kickoffMs(b))
        setGames(weekGames)
      })
  }, [])

  return (
    <div className="sticky top-0 z-10 flex w-full items-center gap-4 border-b border-neutral-200 bg-white px-4 py-2 dark:border-neutral-800 dark:bg-neutral-950">
      <Link to="/" className="shrink-0 pr-4">
        <Logo team="NFL" />
      </Link>
      <Link
        to="/rules"
        className="shrink-0 border-r border-neutral-200 pr-4 text-sm font-medium text-neutral-600 hover:text-neutral-900 dark:border-neutral-800 dark:text-neutral-300 dark:hover:text-neutral-100"
      >
        Fantasy Rules
      </Link>
      <Link
        to="/matches"
        className="shrink-0 border-r border-neutral-200 pr-4 text-sm font-medium text-neutral-600 hover:text-neutral-900 dark:border-neutral-800 dark:text-neutral-300 dark:hover:text-neutral-100"
      >
        Matches
      </Link>
      <div
        className="min-w-0 flex-1 overflow-hidden"
        style={{
          maskImage:
            'linear-gradient(to right, transparent, black 48px, black calc(100% - 48px), transparent)',
          WebkitMaskImage:
            'linear-gradient(to right, transparent, black 48px, black calc(100% - 48px), transparent)',
        }}
      >
        <div className="flex w-max animate-ribbon">
          {[...games, ...games].map((g, i) => (
            <GameTile key={`${g.game_id}-${i}`} game={g} className="mr-2" />
          ))}
        </div>
      </div>
    </div>
  )
}
