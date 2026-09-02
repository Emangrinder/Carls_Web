import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from './supabaseClient'

const SEASONS = [2026, 2025, 2024]
const DEFAULT_SEASON = 2025
const CONFERENCE_ORDER = { AFC: 0, NFC: 1 }

function fmtDiff(n) {
  if (n == null) return '—'
  return n > 0 ? `+${n}` : `${n}`
}

function fmtAvg(n) {
  return n == null ? '—' : n.toFixed(1)
}

const COLUMNS = [
  { key: 'pass_yds_avg', against: 'pass_yds_allowed_avg', label: 'Pass Yds Avg' },
  { key: 'rush_yds_avg', against: 'rush_yds_allowed_avg', label: 'Rush Yds Avg' },
  { key: 'kick_return_yards_avg', against: 'kick_return_yards_allowed_avg', label: 'Kick Ret Avg' },
  { key: 'punt_return_yards_avg', against: 'punt_return_yards_allowed_avg', label: 'Punt Ret Avg' },
]

// sortKey is either 'team', 'win_diff', 'point_diff', or "<stat>:for" / "<stat>:against" / "<stat>:diff"
function getSortValue(row, sortKey) {
  if (sortKey === 'team' || sortKey === 'win_diff' || sortKey === 'point_diff') {
    return row[sortKey]
  }
  const [stat, mode] = sortKey.split(':')
  const col = COLUMNS.find((c) => c.key === stat)
  if (!col) return null
  if (mode === 'for') return row[col.key]
  if (mode === 'against') return row[col.against]
  return (row[col.key] ?? 0) - (row[col.against] ?? 0) // diff
}

function compareRows(a, b, sortKey, sortDir) {
  const va = getSortValue(a, sortKey)
  const vb = getSortValue(b, sortKey)
  let result
  if (typeof va === 'string' || typeof vb === 'string') {
    result = String(va ?? '').localeCompare(String(vb ?? ''))
  } else {
    result = (va ?? -Infinity) - (vb ?? -Infinity)
  }
  return sortDir === 'asc' ? result : -result
}

function SortIndicator({ active, dir }) {
  if (!active) return null
  return <span className="ml-1 text-[10px]">{dir === 'asc' ? '▲' : '▼'}</span>
}

export default function TeamStatsTable() {
  const [season, setSeason] = useState(DEFAULT_SEASON)
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [sortKey, setSortKey] = useState('win_diff')
  const [sortDir, setSortDir] = useState('desc')
  const [groupByConference, setGroupByConference] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    supabase
      .from('team_season_stats')
      .select('*')
      .eq('season', season)
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

  function handleSort(key) {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir(key === 'team' ? 'asc' : 'desc')
    }
  }

  const sortedRows = useMemo(() => {
    const byValue = (a, b) => compareRows(a, b, sortKey, sortDir)
    if (!groupByConference) return [...rows].sort(byValue)
    return [...rows].sort((a, b) => {
      const confDiff = CONFERENCE_ORDER[a.conference] - CONFERENCE_ORDER[b.conference]
      return confDiff !== 0 ? confDiff : byValue(a, b)
    })
  }, [rows, sortKey, sortDir, groupByConference])

  const thBase = 'cursor-pointer select-none hover:text-neutral-900 dark:hover:text-neutral-100'

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

      {loading && <p className="text-sm text-neutral-500">Loading…</p>}
      {error && <p className="text-sm text-red-500">Error: {error}</p>}

      {!loading && !error && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[950px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-neutral-500 dark:border-neutral-800">
                <th className={`${thBase} py-2 pr-2 font-medium`} onClick={() => handleSort('team')}>
                  Team
                  <SortIndicator active={sortKey === 'team'} dir={sortDir} />
                </th>
                <th
                  className={`${thBase} px-2 py-2 text-left font-medium ${groupByConference ? 'text-neutral-900 dark:text-neutral-100' : ''}`}
                  onClick={() => setGroupByConference((g) => !g)}
                  title="Toggle grouping by conference"
                >
                  Conf
                </th>
                <th
                  className={`${thBase} px-2 py-2 text-right font-medium`}
                  onClick={() => handleSort('win_diff')}
                >
                  Record Diff
                  <SortIndicator active={sortKey === 'win_diff'} dir={sortDir} />
                </th>
                {COLUMNS.map((c) => (
                  <th
                    key={c.key}
                    colSpan={2}
                    className={`${thBase} px-2 py-2 text-center font-medium`}
                    onClick={() => handleSort(`${c.key}:diff`)}
                    title={`Sort by ${c.label} differential`}
                  >
                    {c.label}
                    <SortIndicator active={sortKey === `${c.key}:diff`} dir={sortDir} />
                  </th>
                ))}
                <th
                  className={`${thBase} py-2 pl-2 text-right font-medium`}
                  onClick={() => handleSort('point_diff')}
                >
                  Point Diff
                  <SortIndicator active={sortKey === 'point_diff'} dir={sortDir} />
                </th>
              </tr>
              <tr className="border-b border-neutral-200 text-left text-[11px] text-neutral-400 dark:border-neutral-800">
                <th></th>
                <th></th>
                <th></th>
                {COLUMNS.map((c) => (
                  <Fragment key={c.key}>
                    <th
                      className={`${thBase} px-2 pb-1 text-right font-normal`}
                      onClick={() => handleSort(`${c.key}:for`)}
                    >
                      For
                      <SortIndicator active={sortKey === `${c.key}:for`} dir={sortDir} />
                    </th>
                    <th
                      className={`${thBase} px-2 pb-1 text-right font-normal`}
                      onClick={() => handleSort(`${c.key}:against`)}
                    >
                      Against
                      <SortIndicator active={sortKey === `${c.key}:against`} dir={sortDir} />
                    </th>
                  </Fragment>
                ))}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((r) => (
                <tr
                  key={r.team}
                  className="border-b border-neutral-100 dark:border-neutral-900"
                >
                  <td className="py-2 pr-2">
                    <Link
                      to={`/team/${r.team}`}
                      className="flex items-center gap-2 hover:underline"
                    >
                      <img
                        src={`${import.meta.env.BASE_URL}logos/${r.team}.png`}
                        alt={r.team}
                        className="h-6 w-6 object-contain"
                      />
                      <span className="font-medium text-neutral-900 dark:text-neutral-100">
                        {r.team}
                      </span>
                    </Link>
                  </td>
                  <td className="px-2 py-2 text-neutral-500">{r.conference}</td>
                  <td className="px-2 py-2 text-right tabular-nums">
                    {fmtDiff(r.win_diff)}
                  </td>
                  {COLUMNS.map((c) => (
                    <Fragment key={c.key}>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {fmtAvg(r[c.key])}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">
                        {fmtAvg(r[c.against])}
                      </td>
                    </Fragment>
                  ))}
                  <td className="py-2 pl-2 text-right tabular-nums">
                    {fmtDiff(r.point_diff)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
