import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from './supabaseClient'
import LoadingSpinner from './LoadingSpinner'

const CONFERENCE_TEXT = {
  AFC: 'text-red-600 dark:text-red-400',
  NFC: 'text-blue-600 dark:text-blue-400',
}
// Tints the "Conf" header cell to match whichever conference currently
// sorts to the top of the table -- a quick visual cue for which
// conference you're looking at without reading every row.
const CONFERENCE_HEADER_BG = {
  AFC: 'bg-pink-100 dark:bg-pink-950/40',
  NFC: 'bg-sky-100 dark:bg-sky-950/40',
}
// The table body scrolls in its own bounded container rather than the
// page, so sticky headers stick to the top of THAT container (0), not the
// viewport -- overflow-x:auto on the wrapper forces overflow-y to compute
// as auto too per the CSS overflow spec, which makes it the sticky
// containing block regardless of whether it currently has anything to
// scroll internally. So the container's height is measured (see
// useStickyScrollHeight below) to exactly fill the remaining viewport
// below whatever's above it -- that way the page itself never has room to
// scroll independently, and the container's own top edge -- where the
// header sticks -- stays glued directly under the ribbon at all times.
const HEADER_STICKY_TOP = 0
// Measured height of GroupedStatsTable's first (group-label) header row --
// the second (For/Against) row sticks just beneath it.
const HEADER_ROW1_HEIGHT = 37
// position:sticky on <thead>/<tr> itself is unreliable across browsers;
// applying it to each header <th> individually is the robust pattern.
const STICKY_TH = 'sticky z-20 bg-neutral-50 dark:bg-neutral-900'

// Measures how much vertical space is left below the wrapper (down to the
// bottom of the viewport) so the scroll container can be sized to exactly
// fill it -- see the comment on HEADER_STICKY_TOP above for why that
// matters for the sticky header.
function useStickyScrollHeight() {
  const ref = useRef(null)
  const [maxHeight, setMaxHeight] = useState(null)

  useEffect(() => {
    function update() {
      // A momentarily zero/unavailable innerHeight (e.g. a backgrounded tab
      // mid-layout) would otherwise compute a bogus negative max-height.
      if (ref.current && window.innerHeight > 0) {
        setMaxHeight(window.innerHeight - ref.current.getBoundingClientRect().top)
      }
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  return { ref, maxHeight }
}

const SEASONS = [2026, 2025, 2024]
const DEFAULT_SEASON = 2025

// Clicking the Conf header cycles null -> 'AFC' -> 'NFC' -> null; whichever
// one is active sorts to the top of the table (and tints the header to
// match), rather than always forcing AFC first regardless of which the
// header was showing.
function conferenceSortDiff(confGroup, a, b) {
  if (!confGroup) return 0
  const rank = (conf) => (conf === confGroup ? 0 : 1)
  return rank(a.conference) - rank(b.conference)
}

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
          { key: 'pass_defended', against: 'pass_defended_allowed', label: 'PD', fmt: fmtCount },
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

// A faint extra-thick divider after the 16th row of whatever's currently
// sorted -- a quick visual split between the top and bottom half of the
// league by that ranking, regardless of which stat it's sorted by.
function midpointClass(index) {
  return index === 15 ? 'border-b-2 border-neutral-300 dark:border-neutral-700' : ''
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

function GroupedStatsTable({ rows, groups, sortKey, sortDir, confGroup, onSort, onToggleConference }) {
  const thBase = 'cursor-pointer select-none hover:text-neutral-900 dark:hover:text-neutral-100'
  const { ref, maxHeight } = useStickyScrollHeight()

  const sortedRows = useMemo(() => {
    const byValue = (a, b) => compareRows(a, b, sortKey, sortDir, groups)
    if (!confGroup) return [...rows].sort(byValue)
    return [...rows].sort((a, b) => {
      const confDiff = conferenceSortDiff(confGroup, a, b)
      return confDiff !== 0 ? confDiff : byValue(a, b)
    })
  }, [rows, sortKey, sortDir, confGroup, groups])

  // Tint the header by whichever conference is effectively on top --
  // the explicitly-toggled one if there is one, else whichever
  // naturally sorts there.
  const topConference = confGroup ?? sortedRows[0]?.conference

  return (
    <div ref={ref} className="scrollbar-hide overflow-auto" style={{ maxHeight: maxHeight ?? undefined }}>
      <table className="w-full min-w-[950px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-neutral-200 text-left text-neutral-500 dark:border-neutral-800">
            <th
              className={`${thBase} ${STICKY_TH} py-2 pr-2 font-medium`}
              style={{ top: HEADER_STICKY_TOP }}
              onClick={() => onSort('team')}
            >
              Team
              <SortIndicator active={sortKey === 'team'} dir={sortDir} />
            </th>
            <th
              className={`${thBase} sticky z-20 px-2 py-2 text-left font-medium ${confGroup ? 'text-neutral-900 dark:text-neutral-100' : ''} ${CONFERENCE_HEADER_BG[topConference] ?? 'bg-neutral-50 dark:bg-neutral-900'}`}
              style={{ top: HEADER_STICKY_TOP }}
              onClick={onToggleConference}
              title="Cycle grouping: off / AFC on top / NFC on top"
            >
              Conf
            </th>
            <th
              className={`${thBase} ${STICKY_TH} px-2 py-2 text-right font-medium`}
              style={{ top: HEADER_STICKY_TOP }}
              onClick={() => onSort('win_diff')}
            >
              Record Diff
              <SortIndicator active={sortKey === 'win_diff'} dir={sortDir} />
            </th>
            {groups.map((g, i) => (
              <th
                key={g.label}
                colSpan={g.stats.length * 2}
                className={`${thBase} ${STICKY_TH} px-2 py-2 text-center font-medium`}
                style={{ top: HEADER_STICKY_TOP }}
                onClick={() => onSort(`group:${i}`)}
                title={g.sortMode === 'sum' ? `Sort by sum of ${g.stats.map((s) => s.label).join(' + ')}` : `Sort by ${g.label} differential`}
              >
                {g.label}
                <SortIndicator active={sortKey === `group:${i}`} dir={sortDir} />
              </th>
            ))}
            <th
              className={`${thBase} ${STICKY_TH} py-2 pl-2 text-right font-medium`}
              style={{ top: HEADER_STICKY_TOP }}
              onClick={() => onSort('point_diff')}
            >
              Point Diff
              <SortIndicator active={sortKey === 'point_diff'} dir={sortDir} />
            </th>
          </tr>
          <tr className="border-b border-neutral-200 text-left text-[11px] text-neutral-400 dark:border-neutral-800">
            <th className={STICKY_TH} style={{ top: HEADER_STICKY_TOP + HEADER_ROW1_HEIGHT }}></th>
            <th className={STICKY_TH} style={{ top: HEADER_STICKY_TOP + HEADER_ROW1_HEIGHT }}></th>
            <th className={STICKY_TH} style={{ top: HEADER_STICKY_TOP + HEADER_ROW1_HEIGHT }}></th>
            {groups.map((g) =>
              g.stats.map((s) => (
                <Fragment key={s.key}>
                  <th
                    className={`${thBase} ${STICKY_TH} px-2 pb-1 text-right font-normal text-green-600/80 dark:text-green-400/80`}
                    style={{ top: HEADER_STICKY_TOP + HEADER_ROW1_HEIGHT }}
                    onClick={() => onSort(`${s.key}:for`)}
                  >
                    {s.label ? `${s.label} For` : 'For'}
                    <SortIndicator active={sortKey === `${s.key}:for`} dir={sortDir} />
                  </th>
                  <th
                    className={`${thBase} ${STICKY_TH} px-2 pb-1 text-right font-normal text-red-600/80 dark:text-red-400/80`}
                    style={{ top: HEADER_STICKY_TOP + HEADER_ROW1_HEIGHT }}
                    onClick={() => onSort(`${s.key}:against`)}
                  >
                    {s.label ? `${s.label} Ag` : 'Against'}
                    <SortIndicator active={sortKey === `${s.key}:against`} dir={sortDir} />
                  </th>
                </Fragment>
              )),
            )}
            <th className={STICKY_TH} style={{ top: HEADER_STICKY_TOP + HEADER_ROW1_HEIGHT }}></th>
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((r, i) => (
            <tr key={r.team} className={`border-b border-neutral-100 dark:border-neutral-900 ${midpointClass(i)}`}>
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

function ShareStatsTable({ rows, sortKey, sortDir, confGroup, onSort, onToggleConference }) {
  const thBase = 'cursor-pointer select-none hover:text-neutral-900 dark:hover:text-neutral-100'
  const { ref, maxHeight } = useStickyScrollHeight()

  const sortedRows = useMemo(() => {
    const byValue = (a, b) => {
      const va = a[sortKey], vb = b[sortKey]
      const result = typeof va === 'string' ? String(va ?? '').localeCompare(String(vb ?? '')) : (va ?? -Infinity) - (vb ?? -Infinity)
      return sortDir === 'asc' ? result : -result
    }
    if (!confGroup) return [...rows].sort(byValue)
    return [...rows].sort((a, b) => {
      const confDiff = conferenceSortDiff(confGroup, a, b)
      return confDiff !== 0 ? confDiff : byValue(a, b)
    })
  }, [rows, sortKey, sortDir, confGroup])

  // Tint the header by whichever conference is effectively on top --
  // the explicitly-toggled one if there is one, else whichever
  // naturally sorts there.
  const topConference = confGroup ?? sortedRows[0]?.conference

  return (
    <div ref={ref} className="scrollbar-hide overflow-auto" style={{ maxHeight: maxHeight ?? undefined }}>
      <table className="w-full min-w-[900px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-neutral-200 text-left text-neutral-500 dark:border-neutral-800">
            <th
              className={`${thBase} ${STICKY_TH} py-2 pr-2 font-medium`}
              style={{ top: HEADER_STICKY_TOP }}
              onClick={() => onSort('team')}
            >
              Team
              <SortIndicator active={sortKey === 'team'} dir={sortDir} />
            </th>
            <th
              className={`${thBase} sticky z-20 px-2 py-2 text-left font-medium ${confGroup ? 'text-neutral-900 dark:text-neutral-100' : ''} ${CONFERENCE_HEADER_BG[topConference] ?? 'bg-neutral-50 dark:bg-neutral-900'}`}
              style={{ top: HEADER_STICKY_TOP }}
              onClick={onToggleConference}
              title="Cycle grouping: off / AFC on top / NFC on top"
            >
              Conf
            </th>
            {SHARE_COLUMNS.map((c) => (
              <th
                key={c.key}
                className={`${thBase} ${STICKY_TH} px-2 py-2 text-right font-medium`}
                style={{ top: HEADER_STICKY_TOP }}
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
          {sortedRows.map((r, i) => (
            <tr key={r.team} className={`border-b border-neutral-100 dark:border-neutral-900 ${midpointClass(i)}`}>
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
  const [confGroup, setConfGroup] = useState(null)

  function cycleConfGroup() {
    setConfGroup((c) => (c === null ? 'AFC' : c === 'AFC' ? 'NFC' : null))
  }

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
          confGroup={confGroup}
          onSort={handleSort}
          onToggleConference={cycleConfGroup}
        />
      )}

      {!loading && !error && activeTable !== 'share' && (
        <GroupedStatsTable
          rows={rows}
          groups={TABLES[activeTable].groups}
          sortKey={sortKey}
          sortDir={sortDir}
          confGroup={confGroup}
          onSort={handleSort}
          onToggleConference={cycleConfGroup}
        />
      )}

      {/* Pressure/Coverage sort by a summed total, not any one visible
          column -- spell out exactly which columns (already defined on
          each group's own sortFields, not a separate hardcoded list) add
          up to that ranking. */}
      {!loading && !error && activeTable === 'defense' && (
        <p className="mt-3 text-xs text-neutral-400">
          {TABLES.defense.groups
            .map((g) => `${g.label} order = ${g.sortFields.map((f) => g.stats.find((s) => s.key === f)?.label ?? f).join(' + ')}`)
            .join('  ·  ')}
        </p>
      )}
    </div>
  )
}
