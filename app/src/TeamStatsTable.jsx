import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from './supabaseClient'
import LoadingSpinner from './LoadingSpinner'

const CONFERENCE_TEXT = {
  AFC: 'text-red-600 dark:text-red-400',
  NFC: 'text-blue-600 dark:text-blue-400',
}

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

function fmtCount(n) {
  return n ?? '—'
}

function fmtPct(n) {
  return n == null ? '—' : `${n}%`
}

// Each group is a stat category shown as a header spanning its stats' For/
// Against sub-columns. sortMode 'diff' (single stat: sort by for-minus-
// against, e.g. the Yards table) or 'sum' (multiple stats: sort by the sum
// of their FOR values, e.g. "Pressure" = sacks + qb hits + tfl).
const TABLES = {
  yards: {
    label: 'Yards',
    groups: [
      { label: 'Pass Yds Avg', sortMode: 'diff', stats: [{ key: 'pass_yds_avg', against: 'pass_yds_allowed_avg', label: '', fmt: fmtAvg }] },
      { label: 'Rush Yds Avg', sortMode: 'diff', stats: [{ key: 'rush_yds_avg', against: 'rush_yds_allowed_avg', label: '', fmt: fmtAvg }] },
      { label: 'Kick Ret Avg', sortMode: 'diff', stats: [{ key: 'kick_return_yards_avg', against: 'kick_return_yards_allowed_avg', label: '', fmt: fmtAvg }] },
      { label: 'Punt Ret Avg', sortMode: 'diff', stats: [{ key: 'punt_return_yards_avg', against: 'punt_return_yards_allowed_avg', label: '', fmt: fmtAvg }] },
    ],
  },
  defense: {
    label: 'Defense',
    groups: [
      {
        label: 'Pressure',
        sortMode: 'sum',
        sortFields: ['sacks', 'qb_hits', 'tfl'],
        stats: [
          { key: 'sacks', against: 'sacks_allowed', label: 'Sacks', fmt: fmtCount },
          { key: 'qb_hits', against: 'qb_hits_allowed', label: 'QB Hits', fmt: fmtCount },
          { key: 'tfl', against: 'tfl_allowed', label: 'TFL', fmt: fmtCount },
        ],
      },
      {
        label: 'Coverage',
        sortMode: 'sum',
        sortFields: ['pass_defended', 'def_ints'],
        stats: [
          { key: 'pass_defended', against: 'pass_defended_allowed', label: 'Pass Def', fmt: fmtCount },
          { key: 'def_ints', against: 'def_ints_allowed', label: 'INT', fmt: fmtCount },
          { key: 'comp_pct_for', against: 'comp_pct_against', label: 'Comp %', fmt: fmtPct },
        ],
      },
    ],
  },
  scores: {
    label: 'Scores',
    groups: [
      { label: 'Receiving TD', sortMode: 'diff', stats: [{ key: 'rec_td', against: 'rec_td_allowed', label: '', fmt: fmtCount }] },
      { label: 'Rushing TD', sortMode: 'diff', stats: [{ key: 'rush_td', against: 'rush_td_allowed', label: '', fmt: fmtCount }] },
      { label: 'Special Teams TD', sortMode: 'diff', stats: [{ key: 'st_td', against: 'st_td_allowed', label: '', fmt: fmtCount }] },
      { label: 'Defensive TD', sortMode: 'diff', stats: [{ key: 'def_td', against: 'def_td_allowed', label: '', fmt: fmtCount }] },
      { label: 'Field Goals', sortMode: 'diff', stats: [{ key: 'fg_made', against: 'fg_made_allowed', label: '', fmt: fmtCount }] },
    ],
  },
}

function getGroupSortValue(row, group) {
  if (group.sortMode === 'sum') {
    return group.sortFields.reduce((acc, f) => acc + (row[f] ?? 0), 0)
  }
  const s = group.stats[0]
  return (row[s.key] ?? 0) - (row[s.against] ?? 0)
}

// sortKey is 'team' | 'win_diff' | 'point_diff' | 'group:<i>' | '<stat>:for' | '<stat>:against'
function getSortValue(row, sortKey, groups) {
  if (sortKey === 'team' || sortKey === 'win_diff' || sortKey === 'point_diff') {
    return row[sortKey]
  }
  if (sortKey.startsWith('group:')) {
    return getGroupSortValue(row, groups[Number(sortKey.split(':')[1])])
  }
  const [stat, mode] = sortKey.split(':')
  for (const g of groups) {
    const s = g.stats.find((s) => s.key === stat)
    if (s) return mode === 'for' ? row[s.key] : row[s.against]
  }
  return null
}

function compareRows(a, b, sortKey, sortDir, groups) {
  const va = getSortValue(a, sortKey, groups)
  const vb = getSortValue(b, sortKey, groups)
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

function TeamCell({ team }) {
  return (
    <Link to={`/team/${team}`} className="flex items-center gap-2 hover:underline">
      <img
        src={`${import.meta.env.BASE_URL}logos/${team}.png`}
        alt={team}
        className="h-6 w-6 object-contain"
      />
      <span className="font-medium text-neutral-900 dark:text-neutral-100">{team}</span>
    </Link>
  )
}

function GroupedStatsTable({ rows, groups, sortKey, sortDir, groupByConference, onSort, onToggleConference }) {
  const thBase = 'cursor-pointer select-none hover:text-neutral-900 dark:hover:text-neutral-100'

  const sortedRows = useMemo(() => {
    const byValue = (a, b) => compareRows(a, b, sortKey, sortDir, groups)
    if (!groupByConference) return [...rows].sort(byValue)
    return [...rows].sort((a, b) => {
      const confDiff = CONFERENCE_ORDER[a.conference] - CONFERENCE_ORDER[b.conference]
      return confDiff !== 0 ? confDiff : byValue(a, b)
    })
  }, [rows, sortKey, sortDir, groupByConference, groups])

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[950px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-neutral-200 text-left text-neutral-500 dark:border-neutral-800">
            <th className={`${thBase} py-2 pr-2 font-medium`} onClick={() => onSort('team')}>
              Team
              <SortIndicator active={sortKey === 'team'} dir={sortDir} />
            </th>
            <th
              className={`${thBase} px-2 py-2 text-left font-medium ${groupByConference ? 'text-neutral-900 dark:text-neutral-100' : ''}`}
              onClick={onToggleConference}
              title="Toggle grouping by conference"
            >
              Conf
            </th>
            <th className={`${thBase} px-2 py-2 text-right font-medium`} onClick={() => onSort('win_diff')}>
              Record Diff
              <SortIndicator active={sortKey === 'win_diff'} dir={sortDir} />
            </th>
            {groups.map((g, i) => (
              <th
                key={g.label}
                colSpan={g.stats.length * 2}
                className={`${thBase} px-2 py-2 text-center font-medium`}
                onClick={() => onSort(`group:${i}`)}
                title={g.sortMode === 'sum' ? `Sort by sum of ${g.stats.map((s) => s.label).join(' + ')}` : `Sort by ${g.label} differential`}
              >
                {g.label}
                <SortIndicator active={sortKey === `group:${i}`} dir={sortDir} />
              </th>
            ))}
            <th className={`${thBase} py-2 pl-2 text-right font-medium`} onClick={() => onSort('point_diff')}>
              Point Diff
              <SortIndicator active={sortKey === 'point_diff'} dir={sortDir} />
            </th>
          </tr>
          <tr className="border-b border-neutral-200 text-left text-[11px] text-neutral-400 dark:border-neutral-800">
            <th></th>
            <th></th>
            <th></th>
            {groups.map((g) =>
              g.stats.map((s) => (
                <Fragment key={s.key}>
                  <th className={`${thBase} px-2 pb-1 text-right font-normal`} onClick={() => onSort(`${s.key}:for`)}>
                    {s.label ? `${s.label} For` : 'For'}
                    <SortIndicator active={sortKey === `${s.key}:for`} dir={sortDir} />
                  </th>
                  <th className={`${thBase} px-2 pb-1 text-right font-normal`} onClick={() => onSort(`${s.key}:against`)}>
                    {s.label ? `${s.label} Vs` : 'Against'}
                    <SortIndicator active={sortKey === `${s.key}:against`} dir={sortDir} />
                  </th>
                </Fragment>
              )),
            )}
            <th></th>
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((r) => (
            <tr key={r.team} className="border-b border-neutral-100 dark:border-neutral-900">
              <td className="py-2 pr-2">
                <TeamCell team={r.team} />
              </td>
              <td className={`px-2 py-2 text-base font-medium ${CONFERENCE_TEXT[r.conference] ?? 'text-neutral-500'}`}>{r.conference}</td>
              <td className="px-2 py-2 text-right tabular-nums">{fmtDiff(r.win_diff)}</td>
              {groups.map((g) =>
                g.stats.map((s) => (
                  <Fragment key={s.key}>
                    <td className="px-2 py-2 text-right tabular-nums">{s.fmt(r[s.key])}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{s.fmt(r[s.against])}</td>
                  </Fragment>
                )),
              )}
              <td className="py-2 pl-2 text-right tabular-nums">{fmtDiff(r.point_diff)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

const SHARE_COLUMNS = [
  { key: 'qb_share_pct', label: 'QB Share %', title: 'Top QB’s share of team pass attempts — lower means a more volatile/committee QB situation' },
  { key: 'wr_target_pct', label: 'WR Target %' },
  { key: 'wr1_wr2_target_pct_diff', label: 'WR1-WR2 Diff', title: 'Gap between the top individual WR\'s target share and the 2nd WR\'s — a bigger gap means a more one-man passing game' },
  { key: 'te_target_pct', label: 'TE Target %' },
  { key: 'rb_target_pct', label: 'RB Target %' },
  { key: 'rb1_carry_pct', label: 'RB1 Carry %' },
  { key: 'rb2_carry_pct', label: 'RB2 Carry %' },
  { key: 'kr_share_pct', label: 'Top KR %' },
  { key: 'pr_share_pct', label: 'Top PR %' },
]

function ShareStatsTable({ rows, sortKey, sortDir, groupByConference, onSort, onToggleConference }) {
  const thBase = 'cursor-pointer select-none hover:text-neutral-900 dark:hover:text-neutral-100'

  const sortedRows = useMemo(() => {
    const byValue = (a, b) => {
      const va = a[sortKey], vb = b[sortKey]
      const result = typeof va === 'string' ? String(va ?? '').localeCompare(String(vb ?? '')) : (va ?? -Infinity) - (vb ?? -Infinity)
      return sortDir === 'asc' ? result : -result
    }
    if (!groupByConference) return [...rows].sort(byValue)
    return [...rows].sort((a, b) => {
      const confDiff = CONFERENCE_ORDER[a.conference] - CONFERENCE_ORDER[b.conference]
      return confDiff !== 0 ? confDiff : byValue(a, b)
    })
  }, [rows, sortKey, sortDir, groupByConference])

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[900px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-neutral-200 text-left text-neutral-500 dark:border-neutral-800">
            <th className={`${thBase} py-2 pr-2 font-medium`} onClick={() => onSort('team')}>
              Team
              <SortIndicator active={sortKey === 'team'} dir={sortDir} />
            </th>
            <th
              className={`${thBase} px-2 py-2 text-left font-medium ${groupByConference ? 'text-neutral-900 dark:text-neutral-100' : ''}`}
              onClick={onToggleConference}
              title="Toggle grouping by conference"
            >
              Conf
            </th>
            {SHARE_COLUMNS.map((c) => (
              <th
                key={c.key}
                className={`${thBase} px-2 py-2 text-right font-medium`}
                onClick={() => onSort(c.key)}
                title={c.title}
              >
                {c.label}
                <SortIndicator active={sortKey === c.key} dir={sortDir} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((r) => (
            <tr key={r.team} className="border-b border-neutral-100 dark:border-neutral-900">
              <td className="py-2 pr-2">
                <TeamCell team={r.team} />
              </td>
              <td className={`px-2 py-2 text-base font-medium ${CONFERENCE_TEXT[r.conference] ?? 'text-neutral-500'}`}>{r.conference}</td>
              {SHARE_COLUMNS.map((c) => (
                <td key={c.key} className="px-2 py-2 text-right tabular-nums">
                  {fmtPct(r[c.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function TeamStatsTable() {
  const [season, setSeason] = useState(DEFAULT_SEASON)
  const [activeTable, setActiveTable] = useState('yards')
  const [rows, setRows] = useState([])
  const [shareRows, setShareRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [sortKey, setSortKey] = useState('win_diff')
  const [sortDir, setSortDir] = useState('desc')
  const [groupByConference, setGroupByConference] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    Promise.all([
      supabase.from('team_season_stats').select('*').eq('season', season),
      supabase.from('team_share_stats').select('*').eq('season', season),
    ]).then(([statsRes, shareRes]) => {
      if (cancelled) return
      const err = statsRes.error || shareRes.error
      if (err) {
        setError(err.message)
      } else {
        setRows(statsRes.data)
        setShareRows(shareRes.data)
      }
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

  // Switching tables resets to that table's natural default sort, since
  // sort keys from one table's groups don't necessarily exist on another.
  function handleTableChange(tableKey) {
    setActiveTable(tableKey)
    setSortKey(tableKey === 'share' ? 'qb_share_pct' : 'win_diff')
    setSortDir('desc')
  }

  const pillClass = (active) =>
    `rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
      active
        ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900'
        : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700'
    }`

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <div className="mb-3 flex gap-2">
        {SEASONS.map((y) => (
          <button key={y} type="button" onClick={() => setSeason(y)} className={pillClass(y === season)}>
            {y}
          </button>
        ))}
      </div>

      <div className="mb-4 flex gap-2">
        {Object.entries(TABLES).map(([key, t]) => (
          <button key={key} type="button" onClick={() => handleTableChange(key)} className={pillClass(activeTable === key)}>
            {t.label}
          </button>
        ))}
        <button key="share" type="button" onClick={() => handleTableChange('share')} className={pillClass(activeTable === 'share')}>
          Share %
        </button>
      </div>

      {loading && <LoadingSpinner />}
      {error && <p className="text-sm text-red-500">Error: {error}</p>}

      {!loading && !error && activeTable === 'share' && (
        <ShareStatsTable
          rows={shareRows}
          sortKey={sortKey}
          sortDir={sortDir}
          groupByConference={groupByConference}
          onSort={handleSort}
          onToggleConference={() => setGroupByConference((g) => !g)}
        />
      )}

      {!loading && !error && activeTable !== 'share' && (
        <GroupedStatsTable
          rows={rows}
          groups={TABLES[activeTable].groups}
          sortKey={sortKey}
          sortDir={sortDir}
          groupByConference={groupByConference}
          onSort={handleSort}
          onToggleConference={() => setGroupByConference((g) => !g)}
        />
      )}
    </div>
  )
}
