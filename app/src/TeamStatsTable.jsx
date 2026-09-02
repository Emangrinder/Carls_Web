import { useEffect, useState } from 'react'
import { supabase } from './supabaseClient'

const SEASONS = [2025, 2024]

function fmtDiff(n) {
  if (n == null) return '—'
  return n > 0 ? `+${n}` : `${n}`
}

function fmtYds(n) {
  return n == null ? '—' : Math.round(n)
}

export default function TeamStatsTable() {
  const [season, setSeason] = useState(SEASONS[0])
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    supabase
      .from('team_season_stats')
      .select('*')
      .eq('season', season)
      .order('win_diff', { ascending: false })
      .then(({ data, error }) => {
        if (cancelled) return
        if (error) setError(error.message)
        else setRows(data)
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [season])

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6">
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

      {loading && <p className="text-sm text-neutral-500">Loading…</p>}
      {error && <p className="text-sm text-red-500">Error: {error}</p>}

      {!loading && !error && (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-neutral-500 dark:border-neutral-800">
              <th className="py-2 pr-2 font-medium">Team</th>
              <th className="px-2 py-2 text-right font-medium">Record Diff</th>
              <th className="px-2 py-2 text-right font-medium">Yards For</th>
              <th className="px-2 py-2 text-right font-medium">Yards Against</th>
              <th className="py-2 pl-2 text-right font-medium">Point Diff</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.team}
                className="border-b border-neutral-100 dark:border-neutral-900"
              >
                <td className="flex items-center gap-2 py-2 pr-2">
                  <img
                    src={`${import.meta.env.BASE_URL}logos/${r.team}.png`}
                    alt={r.team}
                    className="h-6 w-6 object-contain"
                  />
                  <span className="font-medium text-neutral-900 dark:text-neutral-100">
                    {r.team}
                  </span>
                </td>
                <td className="px-2 py-2 text-right tabular-nums">
                  {fmtDiff(r.win_diff)}
                </td>
                <td className="px-2 py-2 text-right tabular-nums">
                  {fmtYds(r.rush_yds_avg + r.pass_yds_avg)}
                </td>
                <td className="px-2 py-2 text-right tabular-nums">
                  {fmtYds(r.rush_yds_allowed_avg + r.pass_yds_allowed_avg)}
                </td>
                <td className="py-2 pl-2 text-right tabular-nums">
                  {fmtDiff(r.point_diff)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
