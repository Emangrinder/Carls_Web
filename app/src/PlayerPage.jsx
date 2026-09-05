import { Fragment, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from './supabaseClient'
import { CURRENT_TEAMS, TEAM_COLORS } from './constants'
import LoadingSpinner from './LoadingSpinner'

const LOGO_BASE = `${import.meta.env.BASE_URL}logos/`
const POSTSEASON_LABELS = { WC: 'WC', DIV: 'DIV', CON: 'CONF', SB: 'SB' }

function fmtHeight(inches) {
  if (inches == null) return '—'
  const feet = Math.floor(inches / 12)
  const rem = inches % 12
  return `${feet}'${rem}"`
}

function fmtWeight(lbs) {
  return lbs == null ? '—' : `${lbs} lbs`
}

function fmtBirthDate(dateStr) {
  if (!dateStr) return null
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

function fmtDate(dateStr) {
  if (!dateStr) return '—'
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function ageFromBirthDate(dateStr) {
  if (!dateStr) return null
  const birth = new Date(`${dateStr}T00:00:00`)
  const now = new Date()
  let age = now.getFullYear() - birth.getFullYear()
  const hasHadBirthdayThisYear =
    now.getMonth() > birth.getMonth() ||
    (now.getMonth() === birth.getMonth() && now.getDate() >= birth.getDate())
  if (!hasHadBirthdayThisYear) age -= 1
  return age
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

function weekLabel(row) {
  return row.game_type === 'REG' ? `Wk ${row.week}` : (POSTSEASON_LABELS[row.game_type] ?? row.game_type)
}

// Sums a list of numeric fields across rows, treating null/undefined as
// absent (not zero) so a field with no data anywhere renders as "—" rather
// than "0".
function sumFields(rows, fields) {
  const totals = {}
  for (const field of fields) {
    let sum = null
    for (const row of rows) {
      const v = row[field]
      if (v != null) sum = (sum ?? 0) + v
    }
    totals[field] = sum
  }
  return totals
}

function groupBySeason(rows) {
  const map = new Map()
  for (const row of rows) {
    if (!map.has(row.season)) map.set(row.season, [])
    map.get(row.season).push(row)
  }
  return map
}

// Builds season rows (newest season first) plus a trailing career-total
// row, from a Map<season, gameRow[]> where each gameRow's rows within a
// season are already in ascending-week order.
function seasonAggregateRows(bySeasonMap, fields) {
  const seasons = [...bySeasonMap.keys()].sort((a, b) => b - a)
  const seasonRows = seasons.map((season) => {
    const rows = bySeasonMap.get(season)
    return {
      season,
      games: rows.length,
      team: rows[rows.length - 1]?.team ?? null,
      ...sumFields(rows, fields),
    }
  })
  if (seasonRows.length === 0) return []
  const allRows = [...bySeasonMap.values()].flat()
  const career = {
    season: 'Career',
    games: allRows.length,
    team: null,
    ...sumFields(allRows, fields),
    isTotal: true,
  }
  return [...seasonRows, career]
}

// The OL season/career rows built by seasonAggregateRows only sum
// teamOffenseSnaps/sacksAllowed/qbHitsAllowed over the games this player
// personally appeared in -- but "the team's total offensive snaps" and
// "the team's sacks/QB hits allowed" for a season should reflect the whole
// season (all the team's games that year), not just the ones this player
// suited up for. This patches those three fields in place using full-season
// team-level totals instead.
function fixOLSeasonTotals(seasonRows, teamSeasonOffenseSnaps, teamSeasonAllowed) {
  let careerSnaps = 0
  let careerSacks = 0
  let careerHits = 0
  let anySnaps = false
  let anyAllowed = false
  const fixed = seasonRows.map((row) => {
    if (row.isTotal) return row
    const teamSnaps = teamSeasonOffenseSnaps.get(`${row.team}-${row.season}`) ?? null
    const allowed = teamSeasonAllowed.get(`${row.team}-${row.season}`) ?? null
    if (teamSnaps != null) {
      careerSnaps += teamSnaps
      anySnaps = true
    }
    if (allowed) {
      careerSacks += allowed.sacks
      careerHits += allowed.qb_hits
      anyAllowed = true
    }
    return { ...row, teamOffenseSnaps: teamSnaps, sacksAllowed: allowed?.sacks ?? null, qbHitsAllowed: allowed?.qb_hits ?? null }
  })
  return fixed.map((row) =>
    row.isTotal
      ? {
          ...row,
          teamOffenseSnaps: anySnaps ? careerSnaps : null,
          sacksAllowed: anyAllowed ? careerSacks : null,
          qbHitsAllowed: anyAllowed ? careerHits : null,
        }
      : row,
  )
}

// College stats are already one row per season (no per-game drilldown data
// exists for them), so this just sorts newest-first and appends a total.
function collegeCareerRows(rows, fields) {
  if (rows.length === 0) return []
  const sorted = [...rows].sort((a, b) => b.season - a.season)
  const career = {
    season: 'Career',
    games: rows.reduce((sum, r) => sum + (r.games ?? 0), 0),
    ...sumFields(rows, fields),
    isTotal: true,
  }
  return [...sorted, career]
}

function flattenGameRows(rows, snapCountsByGameId, snapField) {
  return rows.map((row) => ({
    ...row,
    season: row.games.season,
    week: row.games.week,
    game_type: row.games.game_type,
    [snapField]: snapCountsByGameId.get(row.game_id)?.[snapField] ?? null,
  }))
}

function fmtNum(n) {
  return n == null || n === 0 ? '—' : n
}

// For "made/att"-style ratios, where showing a dash for a legitimate 0
// would break the fraction's readability.
function fmtRatioNum(n) {
  return n ?? 0
}

function fmtPct(made, att) {
  if (!att) return '—'
  return `${((made / att) * 100).toFixed(1)}%`
}

function fmtRate(yards, attempts) {
  if (!attempts) return '—'
  return (yards / attempts).toFixed(1)
}

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

// A season-by-season stat table with a bolded career-total footer row.
// Non-career rows are clickable to expand a per-game breakdown when
// `gamesBySeason` is provided. `columns` are {header, render(row)} pairs,
// applied unchanged to both season-aggregate and per-game rows since the
// underlying field names match.
function ExpandableSeasonStatTable({ title, seasonRows, gamesBySeason, columns, snapKey }) {
  const [expanded, setExpanded] = useState(() => new Set())
  if (seasonRows.length === 0) return null

  function toggle(season) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(season)) next.delete(season)
      else next.add(season)
      return next
    })
  }

  const totalCols = columns.length + 3 + (snapKey ? 1 : 0)

  return (
    <div className="mb-6">
      <h3 className="mb-2 text-xs font-bold uppercase text-neutral-400">{title}</h3>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-neutral-500 dark:border-neutral-800">
              <th className="w-8 py-2"></th>
              <th className="py-2 pr-3 font-medium">Season</th>
              <th className="px-2 py-2 text-right font-medium">G</th>
              {columns.map((col) => (
                <th key={col.header} className="px-2 py-2 text-right font-medium">
                  {col.header}
                </th>
              ))}
              {snapKey && <th className="px-2 py-2 text-right font-medium">Snaps</th>}
            </tr>
          </thead>
          <tbody>
            {seasonRows.map((row, idx) => {
              const isCareer = row.isTotal
              const games = !isCareer ? gamesBySeason?.get(row.season) ?? [] : []
              const isExpanded = expanded.has(row.season)
              return (
                <Fragment key={idx}>
                  <tr
                    onClick={!isCareer && games.length > 0 ? () => toggle(row.season) : undefined}
                    className={`border-b border-neutral-100 dark:border-neutral-900 ${
                      isCareer
                        ? 'font-semibold text-neutral-900 dark:text-neutral-100'
                        : games.length > 0
                          ? 'cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-900/60'
                          : ''
                    }`}
                  >
                    <td className="py-1.5">
                      <TeamLogo abbr={row.team} size={20} />
                    </td>
                    <td className="py-1.5 pr-3">
                      <span className="inline-flex items-center gap-1.5">
                        {!isCareer && games.length > 0 && (
                          <span className="text-[10px] text-neutral-400">{isExpanded ? '▾' : '▸'}</span>
                        )}
                        {row.season}
                      </span>
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{row.games}</td>
                    {columns.map((col) => (
                      <td key={col.header} className="px-2 py-1.5 text-right tabular-nums">
                        {col.render(row)}
                      </td>
                    ))}
                    {snapKey && (
                      <td className="px-2 py-1.5 text-right tabular-nums">{fmtNum(row[snapKey])}</td>
                    )}
                  </tr>
                  {isExpanded && games.length > 0 && (
                    <tr className="border-b border-neutral-100 dark:border-neutral-900">
                      <td colSpan={totalCols} className="bg-neutral-100/70 px-3 py-2 dark:bg-neutral-900/50">
                        <table className="w-full border-collapse text-xs">
                          <thead>
                            <tr className="text-neutral-400">
                              <th className="w-6"></th>
                              <th className="py-1 pr-2 text-left font-medium">Wk</th>
                              <th className="py-1 pr-2 text-left font-medium">Opp</th>
                              {columns.map((col) => (
                                <th key={col.header} className="px-2 py-1 text-right font-medium">
                                  {col.header}
                                </th>
                              ))}
                              {snapKey && <th className="px-2 py-1 text-right font-medium">Snaps</th>}
                            </tr>
                          </thead>
                          <tbody>
                            {games.map((g) => (
                              <tr key={g.game_id} className="border-t border-neutral-200 dark:border-neutral-800">
                                <td className="py-1">
                                  <TeamLogo abbr={g.team} size={16} />
                                </td>
                                <td className="py-1 pr-2 whitespace-nowrap">{weekLabel(g)}</td>
                                <td className="py-1 pr-2">
                                  <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                                    <TeamLogo abbr={g.opponent_team} size={16} />
                                    {g.opponent_team ?? '—'}
                                  </span>
                                </td>
                                {columns.map((col) => (
                                  <td key={col.header} className="px-2 py-1 text-right tabular-nums">
                                    {col.render(g)}
                                  </td>
                                ))}
                                {snapKey && (
                                  <td className="px-2 py-1 text-right tabular-nums">{fmtNum(g[snapKey])}</td>
                                )}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// Simple non-expandable season table, used for college stats (no per-game
// data exists for them).
function SeasonStatTable({ title, rows, columns }) {
  if (rows.length === 0) return null
  return (
    <div className="mb-6">
      <h3 className="mb-2 text-xs font-bold uppercase text-neutral-400">{title}</h3>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-neutral-500 dark:border-neutral-800">
              <th className="py-2 pr-3 font-medium">Season</th>
              <th className="px-2 py-2 text-right font-medium">G</th>
              {columns.map((col) => (
                <th key={col.header} className="px-2 py-2 text-right font-medium">
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr
                key={idx}
                className={`border-b border-neutral-100 dark:border-neutral-900 ${
                  row.isTotal ? 'font-semibold text-neutral-900 dark:text-neutral-100' : ''
                }`}
              >
                <td className="py-1.5 pr-3">{row.season}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{row.games}</td>
                {columns.map((col) => (
                  <td key={col.header} className="px-2 py-1.5 text-right tabular-nums">
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const PASSING_FIELDS = [
  'completions', 'attempts', 'passing_yards', 'passing_tds', 'passing_interceptions', 'offense_snaps',
]
const PASSING_COLUMNS = [
  { header: 'Cmp/Att', render: (r) => `${fmtRatioNum(r.completions)}/${fmtRatioNum(r.attempts)}` },
  { header: 'Cmp%', render: (r) => fmtPct(r.completions, r.attempts) },
  { header: 'Yds', render: (r) => fmtNum(r.passing_yards) },
  { header: 'TD', render: (r) => fmtNum(r.passing_tds) },
  { header: 'INT', render: (r) => fmtNum(r.passing_interceptions) },
]

const RUSH_REC_FIELDS = [
  'carries', 'rushing_yards', 'rushing_tds',
  'targets', 'receptions', 'receiving_yards', 'receiving_tds', 'offense_snaps',
]
const RUSH_REC_COLUMNS = [
  { header: 'Car', render: (r) => fmtNum(r.carries) },
  { header: 'Rush Yds', render: (r) => fmtNum(r.rushing_yards) },
  { header: 'YPC', render: (r) => fmtRate(r.rushing_yards, r.carries) },
  { header: 'Rush TD', render: (r) => fmtNum(r.rushing_tds) },
  { header: 'Rec', render: (r) => fmtNum(r.receptions) },
  { header: 'Tgt', render: (r) => fmtNum(r.targets) },
  { header: 'Rec Yds', render: (r) => fmtNum(r.receiving_yards) },
  { header: 'Rec TD', render: (r) => fmtNum(r.receiving_tds) },
]

const DEFENSE_FIELDS = [
  'def_tackles_solo', 'def_tackles_with_assist', 'def_tackles_for_loss',
  'def_sacks', 'def_qb_hits', 'def_interceptions', 'def_pass_defended',
  'def_fumbles_forced', 'def_tds', 'defense_snaps',
]
const DEFENSE_COLUMNS = [
  { header: 'Solo', render: (r) => fmtNum(r.def_tackles_solo) },
  { header: 'Ast', render: (r) => fmtNum(r.def_tackles_with_assist) },
  { header: 'TFL', render: (r) => fmtNum(r.def_tackles_for_loss) },
  { header: 'Sacks', render: (r) => fmtNum(r.def_sacks) },
  { header: 'QB Hits', render: (r) => fmtNum(r.def_qb_hits) },
  { header: 'INT', render: (r) => fmtNum(r.def_interceptions) },
  { header: 'PD', render: (r) => fmtNum(r.def_pass_defended) },
  { header: 'FF', render: (r) => fmtNum(r.def_fumbles_forced) },
  { header: 'TD', render: (r) => fmtNum(r.def_tds) },
]

const KICKING_FIELDS = ['fg_made', 'fg_att', 'fg_long', 'pat_made', 'pat_att', 'st_snaps']
const KICKING_COLUMNS = [
  { header: 'FG', render: (r) => `${fmtRatioNum(r.fg_made)}/${fmtRatioNum(r.fg_att)}` },
  { header: 'FG%', render: (r) => fmtPct(r.fg_made, r.fg_att) },
  { header: 'Long', render: (r) => fmtNum(r.fg_long) },
  { header: 'PAT', render: (r) => `${fmtRatioNum(r.pat_made)}/${fmtRatioNum(r.pat_att)}` },
]

const PUNTING_FIELDS = ['pt_att', 'pt_yards', 'pt_net_yards', 'pt_long', 'st_snaps']
const PUNTING_COLUMNS = [
  { header: 'Punts', render: (r) => fmtNum(r.pt_att) },
  { header: 'Yds', render: (r) => fmtNum(r.pt_yards) },
  { header: 'Avg', render: (r) => fmtRate(r.pt_yards, r.pt_att) },
  { header: 'Net Avg', render: (r) => fmtRate(r.pt_net_yards, r.pt_att) },
  { header: 'Long', render: (r) => fmtNum(r.pt_long) },
]

const RETURNS_FIELDS = ['punt_returns', 'punt_return_yards', 'kickoff_returns', 'kickoff_return_yards', 'st_snaps']
const RETURNS_COLUMNS = [
  { header: 'PR', render: (r) => fmtNum(r.punt_returns) },
  { header: 'PR Yds', render: (r) => fmtNum(r.punt_return_yards) },
  { header: 'KR', render: (r) => fmtNum(r.kickoff_returns) },
  { header: 'KR Yds', render: (r) => fmtNum(r.kickoff_return_yards) },
]

// Applied points from player_season_fantasy_points -- computed per the
// Fantasy Rules formulas (app/src/fantasyRulesData.js), each within its
// own eligible-position group (see fantasyRulesData.js's group subtitles).
// Includes touchdown-length bonuses and individual blocked-kick credit
// from nflverse's play-by-play data (build_td_bonuses.py).
//
// Split into the same groups Fantasy Scores toggles by (Defense broken
// into Pressure/Coverage/Turnover) rather than one lumped Defense number.
const FANTASY_BASE_COLUMNS = [
  { header: 'Total', render: (r) => r.total_points },
  { header: 'Avg', render: (r) => r.avg_points },
]
const FANTASY_GROUP_COLUMNS = [
  { key: 'passing_points', header: 'Passing', render: (r) => fmtNum(r.passing_points) },
  { key: 'rushing_points', header: 'Rushing', render: (r) => fmtNum(r.rushing_points) },
  { key: 'receiving_points', header: 'Receiving', render: (r) => fmtNum(r.receiving_points) },
  { key: 'blocking_bonus_points', header: 'Blocking Bonus', render: (r) => fmtNum(r.blocking_bonus_points) },
  { key: 'fumbles_fouls_points', header: 'Fumbles/Fouls', render: (r) => fmtNum(r.fumbles_fouls_points) },
  { key: 'pressure_points', header: 'Pressure', render: (r) => fmtNum(r.pressure_points) },
  { key: 'coverage_points', header: 'Coverage', render: (r) => fmtNum(r.coverage_points) },
  { key: 'turnover_points', header: 'Turnover', render: (r) => fmtNum(r.turnover_points) },
  { key: 'kicking_points', header: 'Kicking', render: (r) => fmtNum(r.kicking_points) },
  { key: 'punting_points', header: 'Punting', render: (r) => fmtNum(r.punting_points) },
  { key: 'returning_points', header: 'Returning', render: (r) => fmtNum(r.returning_points) },
]
// A group's career total has to clear this to earn its own column --
// keeps a single incidental stat (e.g. one fumble-return snap by a QB)
// from cluttering the table with a group that isn't a real part of this
// player's scoring.
const NEGLIGIBLE_FANTASY_POINTS = 3

// nflverse's `players.position` uses generic O-line codes (OT/G/C/T/OL),
// unlike depth_chart_ranks' side-specific abbreviations (LT/LG/C/RG/RT).
const OL_POSITIONS = new Set(['OT', 'G', 'C', 'T', 'OL', 'LT', 'RT', 'LG', 'RG'])
const OL_DEPTH_ABBRS = new Set(['LT', 'LG', 'C', 'RG', 'RT'])
const OL_FIELDS = ['snaps', 'teamOffenseSnaps', 'sacksAllowed', 'qbHitsAllowed']
const OL_COLUMNS = [
  { header: 'Snaps', render: (r) => fmtNum(r.snaps) },
  { header: 'Snap %', render: (r) => (r.teamOffenseSnaps ? `${((r.snaps / r.teamOffenseSnaps) * 100).toFixed(1)}%` : '—') },
  { header: 'Team Sacks Allowed', render: (r) => fmtNum(r.sacksAllowed) },
  { header: 'Team QB Hits Allowed', render: (r) => fmtNum(r.qbHitsAllowed) },
]

const COLLEGE_FIELDS = [
  'rush_att', 'rush_yds', 'rush_td', 'targets', 'receptions', 'rec_yds', 'rec_td',
  'pass_comp', 'pass_att', 'pass_yds', 'pass_td', 'pass_int',
  'def_int', 'def_sacks', 'def_ff', 'def_fr', 'def_pbu',
  'fg_made', 'fg_att',
]
const COLLEGE_PASSING_COLUMNS = [
  { header: 'Cmp/Att', render: (r) => `${fmtRatioNum(r.pass_comp)}/${fmtRatioNum(r.pass_att)}` },
  { header: 'Pass Yds', render: (r) => fmtNum(r.pass_yds) },
  { header: 'Pass TD', render: (r) => fmtNum(r.pass_td) },
  { header: 'INT', render: (r) => fmtNum(r.pass_int) },
]
const COLLEGE_RUSH_REC_COLUMNS = [
  { header: 'Car', render: (r) => fmtNum(r.rush_att) },
  { header: 'Rush Yds', render: (r) => fmtNum(r.rush_yds) },
  { header: 'Rush TD', render: (r) => fmtNum(r.rush_td) },
  { header: 'Rec', render: (r) => fmtNum(r.receptions) },
  { header: 'Tgt', render: (r) => fmtNum(r.targets) },
  { header: 'Rec Yds', render: (r) => fmtNum(r.rec_yds) },
  { header: 'Rec TD', render: (r) => fmtNum(r.rec_td) },
]
const COLLEGE_DEFENSE_COLUMNS = [
  { header: 'Sacks', render: (r) => fmtNum(r.def_sacks) },
  { header: 'INT', render: (r) => fmtNum(r.def_int) },
  { header: 'FF', render: (r) => fmtNum(r.def_ff) },
  { header: 'FR', render: (r) => fmtNum(r.def_fr) },
  { header: 'PBU', render: (r) => fmtNum(r.def_pbu) },
]
const COLLEGE_KICKING_COLUMNS = [
  { header: 'FG', render: (r) => `${fmtRatioNum(r.fg_made)}/${fmtRatioNum(r.fg_att)}` },
  { header: 'FG%', render: (r) => fmtPct(r.fg_made, r.fg_att) },
]

const INJURY_STATUS_STYLES = {
  Out: 'border-red-400 bg-red-50 text-red-600 dark:border-red-700 dark:bg-red-950/40 dark:text-red-400',
  Doubtful: 'border-orange-400 bg-orange-50 text-orange-600 dark:border-orange-700 dark:bg-orange-950/40 dark:text-orange-400',
  Questionable: 'border-yellow-400 bg-yellow-50 text-yellow-600 dark:border-yellow-700 dark:bg-yellow-950/40 dark:text-yellow-500',
}

// Weekly injury reports repeat the same status/injury for as long as it's
// active; collapse consecutive identical weeks (within a season) into one
// event with a week range, so this reads as history rather than a report log.
function collapseInjuryEvents(rows) {
  const events = []
  for (const row of rows) {
    const last = events[events.length - 1]
    const sameEvent =
      last &&
      last.season === row.season &&
      last.report_status === row.report_status &&
      last.report_primary_injury === row.report_primary_injury &&
      row.week === last.weekEnd + 1
    if (sameEvent) {
      last.weekEnd = row.week
    } else {
      events.push({
        season: row.season,
        weekStart: row.week,
        weekEnd: row.week,
        report_status: row.report_status,
        report_primary_injury: row.report_primary_injury,
        report_secondary_injury: row.report_secondary_injury,
      })
    }
  }
  return events.reverse()
}

export default function PlayerPage() {
  const { playerId } = useParams()
  // Rookies not yet crosswalked into `players` (no gsis_id assigned by
  // nflverse yet) are linked by name instead -- see TeamPage's depth-chart
  // links. There's no NFL identity to query in that case, only whatever
  // college data can be found by matching the name.
  const isCollegeOnly = playerId.startsWith('name:')
  const lookupName = isCollegeOnly ? decodeURIComponent(playerId.slice('name:'.length)) : null
  const [player, setPlayer] = useState(null)
  const [depthChart, setDepthChart] = useState([])
  const [injury, setInjury] = useState(null)
  const [offenseRows, setOffenseRows] = useState([])
  const [defenseRows, setDefenseRows] = useState([])
  const [specialTeamsRows, setSpecialTeamsRows] = useState([])
  const [snapCountsRaw, setSnapCountsRaw] = useState([])
  const [collegeSeasons, setCollegeSeasons] = useState([])
  const [collegeRoster, setCollegeRoster] = useState(null)
  const [teamGameStatsRows, setTeamGameStatsRows] = useState([])
  const [injuryHistory, setInjuryHistory] = useState([])
  const [trades, setTrades] = useState([])
  const [teams, setTeams] = useState([])
  const [fantasyPoints, setFantasyPoints] = useState([])
  const [fantasyPointsGames, setFantasyPointsGames] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    if (isCollegeOnly) {
      Promise.all([
        supabase.from('depth_chart_ranks').select('*').ilike('player_name', lookupName).order('rank'),
        supabase
          .from('college_rosters')
          .select('*')
          .ilike('full_name', lookupName)
          .order('season', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase.from('college_player_season_stats').select('*').ilike('player_name', lookupName).order('season'),
        supabase.from('teams').select('team_abbr, team_name').in('team_abbr', CURRENT_TEAMS),
      ]).then(([depthRes, collegeRosterRes, collegeSeasonsRes, teamsRes]) => {
        if (cancelled) return
        const err = depthRes.error || collegeRosterRes.error || collegeSeasonsRes.error || teamsRes.error
        if (err) {
          setError(err.message)
          setLoading(false)
          return
        }
        const roster = collegeRosterRes.data
        setPlayer({
          display_name: lookupName,
          position: roster?.position ?? null,
          height: roster?.height ?? null,
          weight: roster?.weight ?? null,
          college_name: roster?.team ?? null,
          birth_date: null,
          rookie_season: null,
          jersey_number: roster?.jersey ? Number(roster.jersey) : null,
          headshot_url: null,
        })
        setDepthChart(depthRes.data)
        setInjury(null)
        setOffenseRows([])
        setDefenseRows([])
        setSpecialTeamsRows([])
        setSnapCountsRaw([])
        setCollegeSeasons(collegeSeasonsRes.data)
        setCollegeRoster(roster)
        setTeamGameStatsRows([])
        setInjuryHistory([])
        setTrades([])
        setFantasyPoints([])
        setFantasyPointsGames([])
        setTeams(teamsRes.data)
        setLoading(false)
      })
      return () => {
        cancelled = true
      }
    }

    // Fired as a few small sequential batches rather than one dozen-query
    // burst -- the free-tier Postgres connection pool only comfortably
    // handles a handful of concurrent requests, and firing all of them at
    // once was intermittently exhausting it (a random query in the batch
    // would queue behind the rest and occasionally hit the statement
    // timeout entirely, most visible on heavily-statted long-career
    // players with the most rows to join/sort). Each batch still runs
    // concurrently within itself; only the number of batches adds latency.
    Promise.all([
      supabase.from('players').select('*').eq('player_id', playerId).maybeSingle(),
      supabase.from('depth_chart_ranks').select('*').eq('player_id', playerId).order('rank'),
      supabase.from('current_injury_report').select('*').eq('player_id', playerId).maybeSingle(),
      supabase.from('teams').select('team_abbr, team_name').in('team_abbr', CURRENT_TEAMS),
    ])
      .then(([playerRes, depthRes, injuryRes, teamsRes]) => {
        if (cancelled) return Promise.reject({ handled: true })
        const err = playerRes.error || depthRes.error || injuryRes.error || teamsRes.error
        if (err) throw err
        setPlayer(playerRes.data)
        setDepthChart(depthRes.data)
        setInjury(injuryRes.data)
        setTeams(teamsRes.data)

        return Promise.all([
          supabase
            .from('player_offense_stats')
            .select('*, games!inner(season, week, game_type)')
            .eq('player_id', playerId)
            .order('season', { foreignTable: 'games' })
            .order('week', { foreignTable: 'games' }),
          supabase
            .from('player_defense_stats')
            .select('*, games!inner(season, week, game_type)')
            .eq('player_id', playerId)
            .order('season', { foreignTable: 'games' })
            .order('week', { foreignTable: 'games' }),
        ])
      })
      .then(([offenseRes, defenseRes]) => {
        if (cancelled) return Promise.reject({ handled: true })
        const err = offenseRes.error || defenseRes.error
        if (err) throw err
        setOffenseRows(offenseRes.data)
        setDefenseRows(defenseRes.data)

        return Promise.all([
          supabase
            .from('player_special_teams_stats')
            .select('*, games!inner(season, week, game_type)')
            .eq('player_id', playerId)
            .order('season', { foreignTable: 'games' })
            .order('week', { foreignTable: 'games' }),
          supabase
            .from('player_snap_counts')
            .select('*, games!inner(season, week, game_type)')
            .eq('player_id', playerId)
            .order('season', { foreignTable: 'games' })
            .order('week', { foreignTable: 'games' }),
        ])
      })
      .then(([specialRes, snapCountsRes]) => {
        if (cancelled) return Promise.reject({ handled: true })
        const err = specialRes.error || snapCountsRes.error
        if (err) throw err
        setSpecialTeamsRows(specialRes.data)
        setSnapCountsRaw(snapCountsRes.data)

        return Promise.all([
          supabase.from('college_player_season_stats').select('*').eq('player_id', playerId).order('season'),
          supabase
            .from('college_rosters')
            .select('*')
            .eq('player_id', playerId)
            .order('season', { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase.from('injuries').select('*').eq('player_id', playerId).order('season').order('week'),
          supabase.from('trades').select('*').eq('player_id', playerId).order('trade_date', { ascending: false }),
          supabase.from('player_season_fantasy_points').select('*').eq('player_id', playerId).order('season'),
        ]).then(([collegeSeasonsRes, collegeRosterRes, injuryHistoryRes, tradesRes, fantasyPointsRes]) => [
          snapCountsRes,
          collegeSeasonsRes,
          collegeRosterRes,
          injuryHistoryRes,
          tradesRes,
          fantasyPointsRes,
        ])
      })
      .then(([snapCountsRes, collegeSeasonsRes, collegeRosterRes, injuryHistoryRes, tradesRes, fantasyPointsRes]) => {
        if (cancelled) return Promise.reject({ handled: true })
        const err =
          collegeSeasonsRes.error || collegeRosterRes.error || injuryHistoryRes.error || tradesRes.error ||
          fantasyPointsRes.error
        if (err) throw err
        setCollegeSeasons(collegeSeasonsRes.data)
        setCollegeRoster(collegeRosterRes.data)
        setInjuryHistory(injuryHistoryRes.data)
        setTrades(tradesRes.data)
        setFantasyPoints(fantasyPointsRes.data)

        // Per-game fantasy points (for the weekly drilldown) as its own
        // stage rather than folded into the batch above -- keeps every
        // stage's peak concurrency down, which is the whole point of
        // splitting these into stages to begin with (see the comment at
        // the top of this effect).
        return supabase
          .from('player_game_fantasy_points')
          .select('*, games!inner(season, week, game_type, home_team, away_team)')
          .eq('player_id', playerId)
          .order('season', { foreignTable: 'games' })
          .order('week', { foreignTable: 'games' })
          .then((fantasyGamesRes) => [snapCountsRes, fantasyGamesRes])
      })
      .then(([snapCountsRes, fantasyGamesRes]) => {
        if (cancelled) return
        if (fantasyGamesRes.error) throw fantasyGamesRes.error
        setFantasyPointsGames(fantasyGamesRes.data)

        // Team-level per-game context (offensive snaps run, sacks/QB hits
        // allowed) for the OL section -- fetched as a follow-up query since
        // we don't know which teams/seasons are involved until the
        // snap-count rows above come back. Pulls both perspectives (team's
        // own row and the row where they're the opponent) for every
        // relevant game in one shot.
        const involvedTeams = [...new Set(snapCountsRes.data.map((r) => r.team))]
        const involvedSeasons = [...new Set(snapCountsRes.data.map((r) => r.games.season))]
        if (involvedTeams.length === 0) {
          setLoading(false)
          return
        }
        supabase
          .from('team_game_stats')
          .select('game_id, team, opponent_team, season, sacks, qb_hits, offense_snaps')
          .or(`team.in.(${involvedTeams.join(',')}),opponent_team.in.(${involvedTeams.join(',')})`)
          .in('season', involvedSeasons)
          .then(({ data, error: teamStatsError }) => {
            if (cancelled) return
            if (teamStatsError) setError(teamStatsError.message)
            else setTeamGameStatsRows(data)
            setLoading(false)
          })
      })
      .catch((err) => {
        if (cancelled || err?.handled) return
        setError(err.message ?? String(err))
        setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [playerId])

  const teamsByAbbr = useMemo(() => new Map(teams.map((t) => [t.team_abbr, t])), [teams])

  const snapCountsByGameId = useMemo(() => new Map(snapCountsRaw.map((r) => [r.game_id, r])), [snapCountsRaw])

  const offenseRowsAugmented = useMemo(
    () => flattenGameRows(offenseRows, snapCountsByGameId, 'offense_snaps'),
    [offenseRows, snapCountsByGameId],
  )
  const defenseRowsAugmented = useMemo(
    () => flattenGameRows(defenseRows, snapCountsByGameId, 'defense_snaps'),
    [defenseRows, snapCountsByGameId],
  )
  const specialTeamsRowsAugmented = useMemo(
    () => flattenGameRows(specialTeamsRows, snapCountsByGameId, 'st_snaps'),
    [specialTeamsRows, snapCountsByGameId],
  )

  const offenseBySeason = useMemo(() => groupBySeason(offenseRowsAugmented), [offenseRowsAugmented])
  const defenseBySeason = useMemo(() => groupBySeason(defenseRowsAugmented), [defenseRowsAugmented])
  const specialTeamsBySeason = useMemo(() => groupBySeason(specialTeamsRowsAugmented), [specialTeamsRowsAugmented])

  const passingSeasons = useMemo(() => seasonAggregateRows(offenseBySeason, PASSING_FIELDS), [offenseBySeason])
  const rushRecSeasons = useMemo(() => seasonAggregateRows(offenseBySeason, RUSH_REC_FIELDS), [offenseBySeason])
  const defenseSeasons = useMemo(() => seasonAggregateRows(defenseBySeason, DEFENSE_FIELDS), [defenseBySeason])
  const kickingSeasons = useMemo(() => seasonAggregateRows(specialTeamsBySeason, KICKING_FIELDS), [specialTeamsBySeason])
  const puntingSeasons = useMemo(() => seasonAggregateRows(specialTeamsBySeason, PUNTING_FIELDS), [specialTeamsBySeason])
  const returnsSeasons = useMemo(() => seasonAggregateRows(specialTeamsBySeason, RETURNS_FIELDS), [specialTeamsBySeason])

  const collegeCareer = useMemo(() => collegeCareerRows(collegeSeasons, COLLEGE_FIELDS), [collegeSeasons])

  const isOffensiveLine =
    OL_POSITIONS.has(player?.position) || depthChart.some((p) => OL_DEPTH_ABBRS.has(p.position_abbr))

  const ownTeamGameRow = useMemo(
    () => new Map(teamGameStatsRows.map((r) => [`${r.game_id}-${r.team}`, r])),
    [teamGameStatsRows],
  )
  const allowedByGameTeam = useMemo(() => {
    const map = new Map()
    for (const r of teamGameStatsRows) map.set(`${r.game_id}-${r.opponent_team}`, { sacks: r.sacks, qb_hits: r.qb_hits })
    return map
  }, [teamGameStatsRows])

  const olGameRows = useMemo(
    () =>
      snapCountsRaw
        .filter((r) => (r.offense_snaps ?? 0) > 0)
        .map((r) => {
          const own = ownTeamGameRow.get(`${r.game_id}-${r.team}`)
          const allowed = allowedByGameTeam.get(`${r.game_id}-${r.team}`)
          return {
            season: r.games.season,
            week: r.games.week,
            game_type: r.games.game_type,
            game_id: r.game_id,
            team: r.team,
            opponent_team: own?.opponent_team ?? null,
            snaps: r.offense_snaps,
            teamOffenseSnaps: own?.offense_snaps ?? null,
            sacksAllowed: allowed?.sacks ?? null,
            qbHitsAllowed: allowed?.qb_hits ?? null,
          }
        }),
    [snapCountsRaw, ownTeamGameRow, allowedByGameTeam],
  )
  const olBySeason = useMemo(() => groupBySeason(olGameRows), [olGameRows])
  const teamSeasonOffenseSnaps = useMemo(() => {
    const map = new Map()
    for (const r of teamGameStatsRows) {
      const key = `${r.team}-${r.season}`
      map.set(key, (map.get(key) ?? 0) + (r.offense_snaps ?? 0))
    }
    return map
  }, [teamGameStatsRows])
  const teamSeasonAllowed = useMemo(() => {
    const map = new Map()
    for (const r of teamGameStatsRows) {
      const key = `${r.opponent_team}-${r.season}`
      const cur = map.get(key) ?? { sacks: 0, qb_hits: 0 }
      cur.sacks += r.sacks ?? 0
      cur.qb_hits += r.qb_hits ?? 0
      map.set(key, cur)
    }
    return map
  }, [teamGameStatsRows])
  const olSeasons = useMemo(
    () => fixOLSeasonTotals(seasonAggregateRows(olBySeason, OL_FIELDS), teamSeasonOffenseSnaps, teamSeasonAllowed),
    [olBySeason, teamSeasonOffenseSnaps, teamSeasonAllowed],
  )
  const hasOL = isOffensiveLine && olSeasons.length > 0

  const hasPassing = passingSeasons.some((r) => (r.attempts ?? 0) > 0)
  const hasRushRec = rushRecSeasons.some((r) => (r.carries ?? 0) > 0 || (r.targets ?? 0) > 0)
  const hasDefense = defenseSeasons.length > 0
  const hasKicking = kickingSeasons.some((r) => (r.fg_att ?? 0) > 0 || (r.pat_att ?? 0) > 0)
  const hasPunting = puntingSeasons.some((r) => (r.pt_att ?? 0) > 0)
  const hasReturns = returnsSeasons.some((r) => (r.punt_returns ?? 0) > 0 || (r.kickoff_returns ?? 0) > 0)

  // Per-game rows for the expandable weekly drilldown, and (since
  // player_season_fantasy_points has no team column -- a player can play
  // for more than one team in a season) a season/career -> team lookup
  // derived from them for the season table's logo column.
  const fantasyGamesAugmented = useMemo(() => {
    // player_game_fantasy_points has no opponent_team column of its own
    // (unlike the raw offense/defense/special-teams stat tables) -- derive
    // it from the joined game's home/away teams instead.
    const flattened = flattenGameRows(fantasyPointsGames, snapCountsByGameId, 'offense_snaps')
    return flattened.map((row) => ({
      ...row,
      opponent_team: row.games.home_team === row.team ? row.games.away_team : row.games.home_team,
    }))
  }, [fantasyPointsGames, snapCountsByGameId])
  const fantasyGamesBySeason = useMemo(() => groupBySeason(fantasyGamesAugmented), [fantasyGamesAugmented])
  const fantasyTeamBySeason = useMemo(() => {
    const map = new Map()
    for (const g of fantasyGamesAugmented) map.set(g.season, g.team)
    return map
  }, [fantasyGamesAugmented])

  // Career row = a straight sum of the season rows already computed
  // server-side (player_season_fantasy_points), not a separate query.
  // Re-rounded to hundredths since summing already-rounded floats can
  // reintroduce a long floating-point tail (e.g. 0.1 + 0.2).
  const fantasyRows = useMemo(() => {
    if (fantasyPoints.length === 0) return []
    const totals = sumFields(fantasyPoints, [
      'games', 'passing_points', 'rushing_points', 'receiving_points', 'blocking_bonus_points',
      'fumbles_fouls_points', 'pressure_points', 'coverage_points', 'turnover_points',
      'kicking_points', 'punting_points', 'returning_points', 'total_points',
    ])
    for (const key of Object.keys(totals)) {
      if (key !== 'games' && totals[key] != null) totals[key] = Math.round(totals[key] * 100) / 100
    }
    const seasonRowsWithTeam = fantasyPoints.map((row) => ({ ...row, team: fantasyTeamBySeason.get(row.season) }))
    const career = {
      season: 'Career',
      team: fantasyGamesAugmented[fantasyGamesAugmented.length - 1]?.team,
      ...totals,
      avg_points: totals.games ? Math.round((totals.total_points / totals.games) * 100) / 100 : null,
      isTotal: true,
    }
    return [...seasonRowsWithTeam, career]
  }, [fantasyPoints, fantasyTeamBySeason, fantasyGamesAugmented])

  // Only give a group its own column if this player's career total in it
  // clears the negligible threshold -- otherwise it's noise, not a real
  // part of how they score (see NEGLIGIBLE_FANTASY_POINTS above).
  const visibleFantasyColumns = useMemo(() => {
    if (fantasyRows.length === 0) return FANTASY_BASE_COLUMNS
    const career = fantasyRows[fantasyRows.length - 1]
    return [
      ...FANTASY_BASE_COLUMNS,
      ...FANTASY_GROUP_COLUMNS.filter((c) => Math.abs(career[c.key] ?? 0) > NEGLIGIBLE_FANTASY_POINTS),
    ]
  }, [fantasyRows])

  const hasCollegePassing = collegeCareer.some((r) => (r.pass_att ?? 0) > 0)
  const hasCollegeRushRec = collegeCareer.some((r) => (r.rush_att ?? 0) > 0 || (r.targets ?? 0) > 0)
  const hasCollegeDefense = collegeCareer.some(
    (r) => (r.def_sacks ?? 0) > 0 || (r.def_int ?? 0) > 0 || (r.def_ff ?? 0) > 0 || (r.def_fr ?? 0) > 0 || (r.def_pbu ?? 0) > 0,
  )
  const hasCollegeKicking = collegeCareer.some((r) => (r.fg_att ?? 0) > 0)

  const injuryEvents = useMemo(() => collapseInjuryEvents(injuryHistory), [injuryHistory])

  if (loading) return <LoadingSpinner full />
  if (error) return <p className="p-6 text-sm text-red-500">Error: {error}</p>
  if (!player) return <p className="p-6 text-sm text-neutral-500">Player not found.</p>

  // Depth chart is a current-snapshot table (not season-scoped), so a
  // player's row there reflects the team/role they hold right now.
  const currentTeamAbbr = depthChart[0]?.team ?? injury?.team ?? null
  const currentTeam = currentTeamAbbr ? teamsByAbbr.get(currentTeamAbbr) : null
  const injuryStyle = injury?.report_status ? INJURY_STATUS_STYLES[injury.report_status] : null
  const photoUrl = player.headshot_url || collegeRoster?.headshot_url || null

  const teamColors = currentTeamAbbr ? TEAM_COLORS[currentTeamAbbr] : null
  const pageStyle = teamColors
    ? {
        backgroundImage: `linear-gradient(160deg, ${hexToRgba(teamColors.primary, 0.16)} 0%, transparent 45%, ${hexToRgba(teamColors.secondary, 0.14)} 100%)`,
      }
    : undefined

  return (
    <div className="min-h-full w-full" style={pageStyle}>
      <div className="mx-auto w-full max-w-4xl px-4 py-6">
        {isCollegeOnly && (
          <div className="mb-4 rounded border border-yellow-400 bg-yellow-50 px-3 py-2 text-xs text-yellow-800 dark:border-yellow-700 dark:bg-yellow-950/40 dark:text-yellow-300">
            This player hasn't been linked to an NFL player profile yet (nflverse typically assigns this a few
            weeks into a rookie's first season) — showing college stats only.
          </div>
        )}
        {/* Header: photo, name, position/team, bio */}
        <div className="mb-8 flex flex-col gap-6 sm:flex-row sm:items-start">
          {photoUrl ? (
            <img
              src={photoUrl}
              alt={player.display_name}
              className="h-32 w-32 shrink-0 rounded-lg border border-neutral-200 object-cover dark:border-neutral-800"
            />
          ) : (
            <div className="flex h-32 w-32 shrink-0 items-center justify-center rounded-lg border border-neutral-200 bg-neutral-100 text-3xl font-semibold text-neutral-400 dark:border-neutral-800 dark:bg-neutral-800 dark:text-neutral-500">
              {initials(player.display_name)}
            </div>
          )}

          <div className="min-w-0 flex-1">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
                {player.display_name}
              </h1>
              {player.jersey_number != null && (
                <span className="text-lg text-neutral-400">#{player.jersey_number}</span>
              )}
            </div>

            <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-neutral-600 dark:text-neutral-300">
              {depthChart[0] && <span className="font-medium">{depthChart[0].position_abbr}</span>}
              {!depthChart[0] && player.position && <span className="font-medium">{player.position}</span>}
              {currentTeamAbbr && (
                <Link to={`/team/${currentTeamAbbr}`} className="flex items-center gap-1.5 hover:underline">
                  <TeamLogo abbr={currentTeamAbbr} size={20} />
                  {currentTeam?.team_name ?? currentTeamAbbr}
                </Link>
              )}
              {depthChart[0] && (
                <span className="rounded border border-neutral-200 px-1.5 py-0.5 text-xs text-neutral-500 dark:border-neutral-800">
                  {depthChart[0].position_abbr}
                  {depthChart[0].rank}
                </span>
              )}
              {injuryStyle && (
                <span className={`rounded border px-1.5 py-0.5 text-xs font-medium ${injuryStyle}`}>
                  {injury.report_status}
                  {injury.report_primary_injury ? ` — ${injury.report_primary_injury}` : ''}
                </span>
              )}
            </div>

            <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
              <div>
                <dt className="text-neutral-400">Height</dt>
                <dd className="text-neutral-800 dark:text-neutral-200">{fmtHeight(player.height)}</dd>
              </div>
              <div>
                <dt className="text-neutral-400">Weight</dt>
                <dd className="text-neutral-800 dark:text-neutral-200">{fmtWeight(player.weight)}</dd>
              </div>
              <div>
                <dt className="text-neutral-400">College</dt>
                <dd className="text-neutral-800 dark:text-neutral-200">{player.college_name ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-neutral-400">Born</dt>
                <dd className="text-neutral-800 dark:text-neutral-200">
                  {fmtBirthDate(player.birth_date) ?? '—'}
                  {ageFromBirthDate(player.birth_date) != null ? ` (${ageFromBirthDate(player.birth_date)})` : ''}
                </dd>
              </div>
              <div>
                <dt className="text-neutral-400">Rookie Season</dt>
                <dd className="text-neutral-800 dark:text-neutral-200">{player.rookie_season ?? '—'}</dd>
              </div>
            </dl>
          </div>
        </div>

        {/* NFL career */}
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">NFL Career</h2>
        {!hasOL && !hasPassing && !hasRushRec && !hasDefense && !hasKicking && !hasPunting && !hasReturns && (
          <p className="mb-6 text-sm text-neutral-400">No NFL stats on record.</p>
        )}
        {hasOL && (
          <ExpandableSeasonStatTable title="Offensive Line" seasonRows={olSeasons} gamesBySeason={olBySeason} columns={OL_COLUMNS} />
        )}
        {hasPassing && (
          <ExpandableSeasonStatTable
            title="Passing"
            seasonRows={passingSeasons}
            gamesBySeason={offenseBySeason}
            columns={PASSING_COLUMNS}
            snapKey="offense_snaps"
          />
        )}
        {hasRushRec && (
          <ExpandableSeasonStatTable
            title="Rushing & Receiving"
            seasonRows={rushRecSeasons}
            gamesBySeason={offenseBySeason}
            columns={RUSH_REC_COLUMNS}
            snapKey="offense_snaps"
          />
        )}
        {hasDefense && (
          <ExpandableSeasonStatTable
            title="Defense"
            seasonRows={defenseSeasons}
            gamesBySeason={defenseBySeason}
            columns={DEFENSE_COLUMNS}
            snapKey="defense_snaps"
          />
        )}
        {hasKicking && (
          <ExpandableSeasonStatTable
            title="Kicking"
            seasonRows={kickingSeasons}
            gamesBySeason={specialTeamsBySeason}
            columns={KICKING_COLUMNS}
            snapKey="st_snaps"
          />
        )}
        {hasPunting && (
          <ExpandableSeasonStatTable
            title="Punting"
            seasonRows={puntingSeasons}
            gamesBySeason={specialTeamsBySeason}
            columns={PUNTING_COLUMNS}
            snapKey="st_snaps"
          />
        )}
        {hasReturns && (
          <ExpandableSeasonStatTable
            title="Returns"
            seasonRows={returnsSeasons}
            gamesBySeason={specialTeamsBySeason}
            columns={RETURNS_COLUMNS}
            snapKey="st_snaps"
          />
        )}

        {/* Fantasy points */}
        {fantasyRows.length > 0 && (
          <>
            <h2 className="mb-2 mt-4 text-sm font-semibold uppercase tracking-wide text-neutral-500">
              Fantasy Points
            </h2>
            <p className="mb-3 max-w-2xl text-xs text-neutral-400">
              Applied from the{' '}
              <Link to="/rules" className="underline">
                Fantasy Rules
              </Link>{' '}
              formulas -- includes touchdown-length and blocked-kick bonuses from play-by-play data, so a
              category can be non-zero here even if it's not this player's primary position (e.g. a gadget-play
              rushing touchdown for a WR).
            </p>
            <ExpandableSeasonStatTable
              title="By Season"
              seasonRows={fantasyRows}
              gamesBySeason={fantasyGamesBySeason}
              columns={visibleFantasyColumns}
            />
          </>
        )}

        {/* College career */}
        {collegeCareer.length > 0 && (
          <>
            <h2 className="mb-2 mt-4 text-sm font-semibold uppercase tracking-wide text-neutral-500">
              College Career
            </h2>
            {hasCollegePassing && (
              <SeasonStatTable title="Passing" rows={collegeCareer} columns={COLLEGE_PASSING_COLUMNS} />
            )}
            {hasCollegeRushRec && (
              <SeasonStatTable title="Rushing & Receiving" rows={collegeCareer} columns={COLLEGE_RUSH_REC_COLUMNS} />
            )}
            {hasCollegeDefense && (
              <SeasonStatTable title="Defense" rows={collegeCareer} columns={COLLEGE_DEFENSE_COLUMNS} />
            )}
            {hasCollegeKicking && (
              <SeasonStatTable title="Kicking" rows={collegeCareer} columns={COLLEGE_KICKING_COLUMNS} />
            )}
          </>
        )}

        {/* Injury & transaction history */}
        <h2 className="mb-2 mt-4 text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Injury &amp; Transaction History
        </h2>
        <div className="mb-6">
          <h3 className="mb-2 text-xs font-bold uppercase text-neutral-400">Injury Reports</h3>
          {injuryEvents.length === 0 ? (
            <p className="text-sm text-neutral-400">No injury history on record.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-neutral-200 text-left text-neutral-500 dark:border-neutral-800">
                    <th className="py-2 pr-3 font-medium">Season</th>
                    <th className="py-2 pr-3 font-medium">Weeks</th>
                    <th className="py-2 pr-3 font-medium">Status</th>
                    <th className="py-2 font-medium">Injury</th>
                  </tr>
                </thead>
                <tbody>
                  {injuryEvents.map((ev, idx) => (
                    <tr key={idx} className="border-b border-neutral-100 dark:border-neutral-900">
                      <td className="py-1.5 pr-3">{ev.season}</td>
                      <td className="py-1.5 pr-3 tabular-nums">
                        {ev.weekStart === ev.weekEnd ? `Wk ${ev.weekStart}` : `Wk ${ev.weekStart}–${ev.weekEnd}`}
                      </td>
                      <td className="py-1.5 pr-3">
                        <span
                          className={`rounded border px-1.5 py-0.5 text-xs font-medium ${
                            INJURY_STATUS_STYLES[ev.report_status] ?? 'border-neutral-200 text-neutral-500 dark:border-neutral-800'
                          }`}
                        >
                          {ev.report_status ?? '—'}
                        </span>
                      </td>
                      <td className="py-1.5 text-neutral-700 dark:text-neutral-300">
                        {ev.report_primary_injury ?? '—'}
                        {ev.report_secondary_injury ? ` / ${ev.report_secondary_injury}` : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="mb-6">
          <h3 className="mb-2 text-xs font-bold uppercase text-neutral-400">Transactions</h3>
          {trades.length === 0 ? (
            <p className="text-sm text-neutral-400">No trade history on record.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-neutral-200 text-left text-neutral-500 dark:border-neutral-800">
                    <th className="py-2 pr-3 font-medium">Date</th>
                    <th className="py-2 pr-3 font-medium">Teams</th>
                    <th className="py-2 font-medium">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {trades.map((t) => {
                    // A trade row with a draft pick attached means this player
                    // wasn't personally traded -- the PICK that later became
                    // him was, before he existed on any NFL roster.
                    const isPickLineage = t.pick_round != null
                    return (
                      <tr
                        key={`${t.trade_id}-${t.gave_team}-${t.received_team}`}
                        className="border-b border-neutral-100 dark:border-neutral-900"
                      >
                        <td className="py-1.5 pr-3 whitespace-nowrap">{fmtDate(t.trade_date)}</td>
                        <td className="py-1.5 pr-3">
                          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                            <TeamLogo abbr={t.gave_team} size={20} />
                            {t.gave_team}
                            <span className="text-neutral-400">→</span>
                            <TeamLogo abbr={t.received_team} size={20} />
                            {t.received_team}
                          </span>
                        </td>
                        <td className="py-1.5 text-neutral-700 dark:text-neutral-300">
                          {isPickLineage
                            ? `Draft pick traded (${t.pick_season} Rd ${t.pick_round}, Pick ${t.pick_number}) — later used to select this player${t.conditional ? ', conditional' : ''}`
                            : `Player traded directly${t.conditional ? ' (conditional)' : ''}`}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
