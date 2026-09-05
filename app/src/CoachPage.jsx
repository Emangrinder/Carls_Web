import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from './supabaseClient'
import { TEAM_COLORS } from './constants'
import LoadingSpinner from './LoadingSpinner'

const LOGO_BASE = `${import.meta.env.BASE_URL}logos/`
const SEASONS = [2026, 2025, 2024]

function TeamLogo({ abbr, size = 20 }) {
  if (!abbr) return null
  return (
    <img
      src={`${LOGO_BASE}${abbr}.png`}
      alt={abbr}
      className="shrink-0 object-contain"
      style={{ height: `${size}px`, width: `${size}px` }}
    />
  )
}

function initials(name) {
  if (!name) return '?'
  return name
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

function hexToRgba(hex, alpha) {
  const clean = hex.replace('#', '')
  const n = parseInt(clean, 16)
  const r = (n >> 16) & 255
  const g = (n >> 8) & 255
  const b = n & 255
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function fmtDiff(n) {
  if (n == null) return '—'
  return n > 0 ? `+${n}` : `${n}`
}

export default function CoachPage() {
  const { teamAbbr } = useParams()
  const [staff, setStaff] = useState(null)
  const [team, setTeam] = useState(null)
  const [seasonStats, setSeasonStats] = useState([])
  const [fantasyPoints, setFantasyPoints] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    Promise.all([
      supabase.from('current_coaching_staff').select('*').eq('team', teamAbbr).eq('role', 'HC').maybeSingle(),
      supabase.from('teams').select('*').eq('team_abbr', teamAbbr).maybeSingle(),
      supabase.from('team_season_stats').select('*').eq('team', teamAbbr).order('season', { ascending: false }),
      supabase.from('team_season_fantasy_points').select('*').eq('team', teamAbbr).order('season', { ascending: false }),
    ]).then(([staffRes, teamRes, statsRes, fpRes]) => {
      if (cancelled) return
      const err = staffRes.error || teamRes.error || statsRes.error || fpRes.error
      if (err) {
        setError(err.message)
      } else {
        setStaff(staffRes.data)
        setTeam(teamRes.data)
        setSeasonStats(statsRes.data)
        setFantasyPoints(fpRes.data)
      }
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [teamAbbr])

  if (loading) return <LoadingSpinner full />
  if (error) return <p className="p-6 text-sm text-red-500">Error: {error}</p>
  if (!staff) return <p className="p-6 text-sm text-neutral-500">No head coach on record for this team.</p>

  const fpBySeason = new Map(fantasyPoints.map((r) => [r.season, r]))
  const teamColors = TEAM_COLORS[teamAbbr]
  const pageStyle = teamColors
    ? {
        backgroundImage: `linear-gradient(160deg, ${hexToRgba(teamColors.primary, 0.16)} 0%, transparent 45%, ${hexToRgba(teamColors.secondary, 0.14)} 100%)`,
      }
    : undefined

  return (
    <div className="min-h-full w-full" style={pageStyle}>
      <div className="mx-auto w-full max-w-4xl px-4 py-6">
        <div className="mb-4 rounded border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900/60">
          No photo is available for coaches in our data source (nflverse doesn't publish coach headshots) --
          shown with initials instead. Season rows before {staff.since_year ?? 'this coach\'s hire year'} reflect
          the team's results, not necessarily under this coach.
        </div>

        <div className="mb-8 flex flex-col gap-6 sm:flex-row sm:items-start">
          <div className="flex h-32 w-32 shrink-0 items-center justify-center rounded-lg border border-neutral-200 bg-neutral-100 text-3xl font-semibold text-neutral-400 dark:border-neutral-800 dark:bg-neutral-800 dark:text-neutral-500">
            {initials(staff.coach_name)}
          </div>

          <div className="min-w-0 flex-1">
            <h1 className="mb-1 text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
              {staff.coach_name}
            </h1>
            <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-neutral-600 dark:text-neutral-300">
              <span className="font-medium">Head Coach</span>
              <Link to={`/team/${teamAbbr}`} className="flex items-center gap-1.5 hover:underline">
                <TeamLogo abbr={teamAbbr} size={20} />
                {team?.team_name ?? teamAbbr}
              </Link>
              {staff.since_year && (
                <span className="rounded border border-neutral-200 px-1.5 py-0.5 text-xs text-neutral-500 dark:border-neutral-800">
                  Since {staff.since_year}
                </span>
              )}
            </div>
          </div>
        </div>

        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Record By Season
        </h2>
        {seasonStats.length === 0 ? (
          <p className="text-sm text-neutral-400">No season results on record.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-left text-neutral-500 dark:border-neutral-800">
                  <th className="py-2 pr-3 font-medium">Season</th>
                  <th className="px-2 py-2 text-right font-medium">G</th>
                  <th className="px-2 py-2 text-right font-medium">W</th>
                  <th className="px-2 py-2 text-right font-medium">L</th>
                  <th className="px-2 py-2 text-right font-medium">T</th>
                  <th className="px-2 py-2 text-right font-medium">Pts For</th>
                  <th className="px-2 py-2 text-right font-medium">Pts Against</th>
                  <th className="px-2 py-2 text-right font-medium">Pt Diff</th>
                  <th className="px-2 py-2 text-right font-medium">Head Coach Pts</th>
                </tr>
              </thead>
              <tbody>
                {SEASONS.map((season) => {
                  const s = seasonStats.find((r) => r.season === season)
                  const fp = fpBySeason.get(season)
                  if (!s) return null
                  return (
                    <tr key={season} className="border-b border-neutral-100 dark:border-neutral-900">
                      <td className="py-1.5 pr-3 font-medium text-neutral-900 dark:text-neutral-100">{season}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{s.games_played}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{s.wins}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{s.losses}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{s.ties}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{s.points_for}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{s.points_against}</td>
                      <td className="px-2 py-1.5 text-right font-medium tabular-nums">{fmtDiff(s.point_diff)}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{fp?.coach_head_points ?? '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <p className="mt-8 text-xs text-neutral-400">
          Personal, non-commercial fan project. Not affiliated with, endorsed by, or sponsored by the NFL or any
          NFL team. Team names, logos, and marks are the property of their respective owners.
        </p>
      </div>
    </div>
  )
}
