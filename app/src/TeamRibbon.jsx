import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
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

// A single control cycling between the app's top-level pages instead of
// showing them all as separate links -- click an arrow (or the faded
// preview row itself), it moves to the next/previous page (wrapping at
// the ends), with a peek at the adjacent option above/below like a
// rotating dial.
const NAV_PAGES = [
  { path: '/', label: 'NFL Teams' },
  { path: '/rules', label: 'Fantasy Rules' },
  { path: '/matches', label: 'NFL Matches' },
  { path: '/scores', label: 'Fantasy Scores' },
]

function PageSpinner() {
  const location = useLocation()
  const navigate = useNavigate()
  const activeIndex = NAV_PAGES.findIndex((p) =>
    p.path === '/' ? location.pathname === '/' : location.pathname.startsWith(p.path),
  )
  const index = activeIndex === -1 ? 0 : activeIndex

  const prevPage = NAV_PAGES[(index - 1 + NAV_PAGES.length) % NAV_PAGES.length]
  const nextPage = NAV_PAGES[(index + 1) % NAV_PAGES.length]

  function go(delta) {
    const next = (index + delta + NAV_PAGES.length) % NAV_PAGES.length
    navigate(NAV_PAGES[next].path)
  }

  return (
    <div className="flex w-32 shrink-0 flex-col items-center border-r border-neutral-200 pr-4 leading-none dark:border-neutral-800">
      <button
        type="button"
        onClick={() => go(-1)}
        aria-label="Previous page"
        className="truncate pb-0.5 text-[10px] text-neutral-300 transition-colors hover:text-neutral-600 dark:text-neutral-700 dark:hover:text-neutral-400"
      >
        <span className="truncate">{prevPage.label}</span>
      </button>
      <Link
        to={NAV_PAGES[index].path}
        className="py-0.5 text-center text-sm font-medium text-neutral-600 transition-colors hover:text-neutral-900 dark:text-neutral-300 dark:hover:text-neutral-100"
      >
        {NAV_PAGES[index].label}
      </Link>
      <button
        type="button"
        onClick={() => go(1)}
        aria-label="Next page"
        className="truncate pt-0.5 text-[10px] text-neutral-300 transition-colors hover:text-neutral-600 dark:text-neutral-700 dark:hover:text-neutral-400"
      >
        <span className="truncate">{nextPage.label}</span>
      </button>
    </div>
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

// Hours-since-sync mapped to a red ("hot" -- the nflverse pull just
// happened) -> blue ("cold" -- it's been a while) hue, capped at a full day
// since the ETL cron (.github/workflows/nflverse-etl.yml) runs nightly and
// anything older than that is already the oldest this indicator should
// bother distinguishing.
const SYNC_HUE_CAP_HOURS = 24

function syncHue(hours) {
  const t = Math.min(Math.max(hours, 0), SYNC_HUE_CAP_HOURS) / SYNC_HUE_CAP_HOURS
  return Math.round(t * 230) // 0deg = red, 230deg = blue
}

function useSyncStatus() {
  const [lastSyncedAt, setLastSyncedAt] = useState(null)

  useEffect(() => {
    supabase
      .from('sync_log')
      .select('last_synced_at')
      .maybeSingle()
      .then(({ data, error }) => {
        if (error || !data) return
        setLastSyncedAt(data.last_synced_at)
      })
  }, [])

  if (!lastSyncedAt) return null
  const hours = (Date.now() - new Date(lastSyncedAt).getTime()) / (1000 * 60 * 60)
  return { lastSyncedAt, hours }
}

// Minutes once the pull is under an hour old (so it doesn't just round down
// to "0h" right after a fresh sync), hours otherwise.
function syncBadge(hours) {
  if (hours < 1) return { value: Math.round(hours * 60), unit: 'm' }
  return { value: Math.round(hours), unit: 'h' }
}

// Wraps the NFL logo with a colored ring plus a small time-since-sync badge
// at its bottom-right, so data freshness is visible at a glance without a
// separate element that can end up hidden at narrow widths.
function SyncRing({ children }) {
  const status = useSyncStatus()
  if (!status) return children

  const hue = syncHue(status.hours)
  const { value, unit } = syncBadge(status.hours)

  return (
    <span
      className="relative inline-flex shrink-0 rounded-full"
      style={{ boxShadow: `0 0 0 2px hsl(${hue}deg 75% 50%)` }}
      title={`Last nflverse pull: ${new Date(status.lastSyncedAt).toLocaleString()} (${value}${unit} ago)`}
    >
      {children}
      <span
        className="absolute -bottom-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[9px] font-semibold text-white"
        style={{ backgroundColor: `hsl(${hue}deg 75% 42%)` }}
      >
        {value}
      </span>
    </span>
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
        <SyncRing>
          <Logo team="NFL" />
        </SyncRing>
      </Link>
      <PageSpinner />
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
