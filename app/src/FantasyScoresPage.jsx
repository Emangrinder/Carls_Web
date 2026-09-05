import { useState } from 'react'

const SEASONS = [2026, 2025, 2024]
const DEFAULT_SEASON = 2025
const WEEKS = Array.from({ length: 18 }, (_, i) => i + 1)

// Which rule-set the table is currently showing. "Season" is the special
// week-by-week fantasy-points view; every other button swaps the columns
// after Total/Avg to that category's own underlying counting stats
// instead. These categories aren't identical to the Fantasy Rules page's
// tags -- Defense is split into the three sub-components the league
// actually compares (pressure/coverage/turnovers), and Kicking folds in
// Punting since both are the same lone specialist roster slot.
const SCORE_CATEGORIES = [
  { key: 'season', label: 'Season', mode: 'weeks' },
  { key: 'passing', label: 'Passing', mode: 'stats' },
  { key: 'rushing-receiving', label: 'Rushing/Receiving', mode: 'stats' },
  { key: 'defense-all', label: 'All Defense', mode: 'stats' },
  { key: 'defense-pressure', label: 'Defense Pressure', mode: 'stats', note: 'TFL, QB Hits, Sacks' },
  { key: 'defense-coverage', label: 'Defense Coverage', mode: 'stats', note: 'Tackles, Assist Tackles, PDs' },
  { key: 'defense-turnovers', label: 'Defense Turnovers', mode: 'stats', note: 'FF, FR, INT, FR Yds, INT Ret Yds' },
  { key: 'kicking', label: 'Kicking', mode: 'stats', note: 'Includes punting' },
  { key: 'returning', label: 'Returning', mode: 'stats' },
  { key: 'blocking-bonus', label: 'Blocking Bonus', mode: 'stats' },
  { key: 'coach', label: 'Coach', mode: 'stats' },
  { key: 'team-defense', label: 'Team Defense', mode: 'stats' },
  { key: 'team-offense', label: 'Team Offense', mode: 'stats' },
]

// The underlying counting stats shown per category once "Season" isn't
// selected -- these feed that category's fantasy points, per Fantasy Rules.
const STAT_COLUMNS = {
  passing: [
    { key: 'comp', label: 'Comp' },
    { key: 'att', label: 'Att' },
    { key: 'yds', label: 'Yds' },
    { key: 'td', label: 'TD' },
    { key: 'int', label: 'INT' },
  ],
  'rushing-receiving': [
    { key: 'rushAtt', label: 'Rush Att' },
    { key: 'rushYds', label: 'Rush Yds' },
    { key: 'rushTd', label: 'Rush TD' },
    { key: 'rec', label: 'Rec' },
    { key: 'recYds', label: 'Rec Yds' },
    { key: 'recTd', label: 'Rec TD' },
  ],
  'defense-all': [
    { key: 'tkl', label: 'Tackles' },
    { key: 'ast', label: 'Assists' },
    { key: 'sacks', label: 'Sacks' },
    { key: 'tfl', label: 'TFL' },
    { key: 'qbHits', label: 'QB Hits' },
    { key: 'int', label: 'INT' },
    { key: 'pd', label: 'PD' },
    { key: 'ff', label: 'FF' },
    { key: 'fr', label: 'FR' },
  ],
  'defense-pressure': [
    { key: 'tfl', label: 'TFL' },
    { key: 'qbHits', label: 'QB Hits' },
    { key: 'sacks', label: 'Sacks' },
  ],
  'defense-coverage': [
    { key: 'tkl', label: 'Tackles' },
    { key: 'ast', label: 'Assists' },
    { key: 'pd', label: 'PD' },
  ],
  'defense-turnovers': [
    { key: 'ff', label: 'FF' },
    { key: 'fr', label: 'FR' },
    { key: 'int', label: 'INT' },
    { key: 'frYds', label: 'FR Yds' },
    { key: 'intYds', label: 'INT Ret Yds' },
  ],
  kicking: [
    { key: 'fgMade', label: 'FG Made' },
    { key: 'fgAtt', label: 'FG Att' },
    { key: 'xpMade', label: 'XP Made' },
    { key: 'punts', label: 'Punts' },
    { key: 'puntYds', label: 'Punt Yds' },
    { key: 'puntAvg', label: 'Punt Avg' },
  ],
  returning: [
    { key: 'kr', label: 'KR' },
    { key: 'krYds', label: 'KR Yds' },
    { key: 'pr', label: 'PR' },
    { key: 'prYds', label: 'PR Yds' },
  ],
  'blocking-bonus': [
    { key: 'avgPassComp', label: 'Avg/Comp' },
    { key: 'avgRush', label: 'Avg/Rush' },
    { key: 'rushAtt', label: 'Rush Att' },
    { key: 'avgRec', label: 'Avg/Rec' },
  ],
  coach: [
    { key: 'won', label: 'Won' },
    { key: 'lost', label: 'Lost' },
    { key: 'tied', label: 'Tied' },
    { key: 'ptDiff', label: 'Pt Diff' },
  ],
  'team-defense': [
    { key: 'oppPassTd', label: 'Opp Pass TD' },
    { key: 'oppRushTd', label: 'Opp Rush TD' },
    { key: 'sacks', label: 'Sacks' },
    { key: 'int', label: 'INT' },
    { key: 'passYdsAllowed', label: 'Pass Yds Allowed' },
    { key: 'rushYdsAllowed', label: 'Rush Yds Allowed' },
  ],
  'team-offense': [
    { key: 'passTd', label: 'Pass TD' },
    { key: 'rushTd', label: 'Rush TD' },
    { key: 'fgMade', label: 'FG Made' },
    { key: 'firstDowns', label: 'First Downs' },
    { key: 'fumblesLost', label: 'Fumbles Lost' },
  ],
}

// Preview-only mock rows -- there's no fantasy-scoring database yet (the
// real version needs a new table built from the Fantasy Rules formulas,
// generalized across whichever roster position actually recorded each
// event). Just enough here to see the shape of the table before that
// work happens. `category` is which SCORE_CATEGORIES button surfaces this
// row -- "defense-all" matches any category starting with "defense-".
// `isTeam` rows (Team Defense/Offense) show the full team name, not a
// player's last name.
const MOCK_ROWS = [
  { name: 'Josh Allen', legalPosition: 'QB', team: 'BUF', category: 'passing', seasonAvg: 24.8 },
  { name: 'Saquon Barkley', legalPosition: 'IDP/Skill', team: 'PHI', category: 'rushing-receiving', seasonAvg: 21.3 },
  { name: "Ja'Marr Chase", legalPosition: 'IDP/Skill', team: 'CIN', category: 'rushing-receiving', seasonAvg: 19.6 },
  { name: 'Travis Kelce', legalPosition: 'IDP/Skill', team: 'KC', category: 'rushing-receiving', seasonAvg: 15.2 },
  { name: 'Myles Garrett', legalPosition: 'IDP/Skill', team: 'CLE', category: 'defense-pressure', seasonAvg: 12.7 },
  { name: 'Fred Warner', legalPosition: 'IDP/Skill', team: 'SF', category: 'defense-coverage', seasonAvg: 13.9 },
  { name: 'Patrick Surtain II', legalPosition: 'IDP/Skill', team: 'DEN', category: 'defense-turnovers', seasonAvg: 11.1 },
  { name: 'Justin Tucker', legalPosition: 'PK', team: 'BAL', category: 'kicking', seasonAvg: 9.4 },
  { name: 'KaVontae Turpin', legalPosition: 'IDP/Skill', team: 'DAL', category: 'returning', seasonAvg: 8.2 },
  { name: 'Kyle Juszczyk', legalPosition: 'IDP/Skill', team: 'SF', category: 'blocking-bonus', seasonAvg: 4.3 },
  { name: 'Andy Reid', legalPosition: 'Head Coach', team: 'KC', category: 'coach', seasonAvg: 6.1 },
  { name: 'Buffalo Bills', legalPosition: 'Def', team: 'BUF', category: 'team-defense', seasonAvg: 14.2, isTeam: true },
  { name: 'Kansas City Chiefs', legalPosition: 'ST', team: 'KC', category: 'team-offense', seasonAvg: 16.8, isTeam: true },
]

function lastNameOnly(fullName) {
  const rest = fullName.split(' ').slice(1).join(' ')
  return rest || fullName
}

function mockWeekScore(seed, week) {
  // Deterministic pseudo-random placeholder so reloading doesn't jitter.
  const n = Math.sin(seed * 999 + week) * 10000
  return Math.round(((n - Math.floor(n)) * 20 + 2) * 10) / 10
}

function mockStatValue(seed, colIndex) {
  const n = Math.sin(seed * 555 + colIndex * 37) * 10000
  return Math.round((n - Math.floor(n)) * 20)
}

// Pixel widths/offsets for the frozen columns (logo, name, total, avg) --
// sticky-left needs each cell's own cumulative offset and an opaque
// background so scrolled columns don't show through.
const COL_WIDTHS = { logo: 44, name: 108, total: 64, avg: 60 }
const COL_LEFT = {
  logo: 0,
  name: COL_WIDTHS.logo,
  total: COL_WIDTHS.logo + COL_WIDTHS.name,
  avg: COL_WIDTHS.logo + COL_WIDTHS.name + COL_WIDTHS.total,
}
const SCROLL_COL_WIDTH = 56
const FROZEN_WIDTH = COL_LEFT.avg + COL_WIDTHS.avg
const FROZEN_TD = 'sticky z-10 bg-neutral-50 dark:bg-neutral-900'
const DIVIDER_STYLE = { borderRight: '1px solid rgba(120,120,120,0.25)' }

export default function FantasyScoresPage() {
  const [season, setSeason] = useState(DEFAULT_SEASON)
  const [category, setCategory] = useState(SCORE_CATEGORIES[0].key)

  const activeCategory = SCORE_CATEGORIES.find((c) => c.key === category)
  const rows =
    category === 'season'
      ? MOCK_ROWS
      : MOCK_ROWS.filter((r) => (category === 'defense-all' ? r.category.startsWith('defense-') : r.category === category))
  const scrollColumns = activeCategory.mode === 'weeks' ? WEEKS.map((w) => ({ key: w, label: `Wk ${w}` })) : STAT_COLUMNS[category]
  // table-layout:fixed alone doesn't stop a <table> shrinking below the
  // sum of its declared column widths to fit its container -- an explicit
  // total width forces it, which is what makes the wrapper's
  // overflow-x-auto have real excess width to scroll.
  const tableWidth = FROZEN_WIDTH + SCROLL_COL_WIDTH * scrollColumns.length

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <h1 className="mb-2 text-2xl font-semibold text-neutral-900 dark:text-neutral-100">Fantasy Scores</h1>
      <p className="mb-4 max-w-2xl text-sm text-neutral-500">
        Top fantasy scorers among the legal roster positions, using the{' '}
        <a href="#/rules" className="underline">
          Fantasy Rules
        </a>{' '}
        scoring formulas. This is a layout preview -- the real scoring numbers need a new database
        table computed from every player's actual weekly stats generalized to the legal positions, not
        real data yet.
      </p>

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

      <div className="mb-4 flex flex-wrap gap-1.5">
        {SCORE_CATEGORIES.map((c) => (
          <button
            key={c.key}
            type="button"
            title={c.note}
            onClick={() => setCategory(c.key)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              category === c.key
                ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900'
                : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      <div className="mb-4 rounded border border-yellow-300 bg-yellow-50 px-3 py-2 text-xs text-yellow-800 dark:border-yellow-800 dark:bg-yellow-950/30 dark:text-yellow-400">
        Preview data below -- not real scores yet.
      </div>

      <div className="overflow-x-auto">
        <table className="border-collapse text-sm" style={{ tableLayout: 'fixed', width: tableWidth }}>
          <thead>
            <tr className="border-b border-neutral-200 text-left text-neutral-500 dark:border-neutral-800">
              <th className={`${FROZEN_TD} py-2 font-medium`} style={{ left: COL_LEFT.logo, width: COL_WIDTHS.logo }} />
              <th className={`${FROZEN_TD} py-2 pr-2 font-medium`} style={{ left: COL_LEFT.name, width: COL_WIDTHS.name }}>
                Player
              </th>
              <th
                className={`${FROZEN_TD} px-2 py-2 text-right font-medium`}
                style={{ left: COL_LEFT.total, width: COL_WIDTHS.total }}
              >
                Total
              </th>
              <th
                className={`${FROZEN_TD} px-2 py-2 text-right font-medium`}
                style={{ left: COL_LEFT.avg, width: COL_WIDTHS.avg, ...DIVIDER_STYLE }}
              >
                Avg
              </th>
              {scrollColumns.map((col) => (
                <th key={col.key} className="px-2 py-2 text-right font-medium" style={{ width: SCROLL_COL_WIDTH }}>
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={4 + scrollColumns.length} className="py-6 text-center text-sm text-neutral-400">
                  No preview rows tagged for this category yet.
                </td>
              </tr>
            )}
            {rows.map((r, i) => {
              const weekScores = activeCategory.mode === 'weeks' ? WEEKS.map((w) => mockWeekScore(i + 1, w)) : null
              const total = weekScores
                ? Math.round(weekScores.reduce((a, b) => a + b, 0) * 10) / 10
                : Math.round(r.seasonAvg * 17 * 10) / 10
              return (
                <tr key={r.name} className="border-b border-neutral-100 dark:border-neutral-900">
                  <td className={`${FROZEN_TD} py-2`} style={{ left: COL_LEFT.logo, width: COL_WIDTHS.logo }}>
                    <img
                      src={`${import.meta.env.BASE_URL}logos/${r.team}.png`}
                      alt={r.team}
                      className="h-6 w-6 object-contain"
                    />
                  </td>
                  <td className={`${FROZEN_TD} py-2 pr-2`} style={{ left: COL_LEFT.name, width: COL_WIDTHS.name }}>
                    <div className="truncate font-medium text-neutral-900 dark:text-neutral-100">
                      {r.isTeam ? r.name : lastNameOnly(r.name)}
                    </div>
                    <div className="text-xs text-neutral-400">{r.legalPosition}</div>
                  </td>
                  <td
                    className={`${FROZEN_TD} px-2 py-2 text-right font-semibold tabular-nums text-neutral-900 dark:text-neutral-100`}
                    style={{ left: COL_LEFT.total, width: COL_WIDTHS.total }}
                  >
                    {total}
                  </td>
                  <td
                    className={`${FROZEN_TD} px-2 py-2 text-right tabular-nums text-neutral-600 dark:text-neutral-400`}
                    style={{ left: COL_LEFT.avg, width: COL_WIDTHS.avg, ...DIVIDER_STYLE }}
                  >
                    {r.seasonAvg}
                  </td>
                  {activeCategory.mode === 'weeks'
                    ? weekScores.map((s, wi) => (
                        <td key={wi} className="px-2 py-2 text-right tabular-nums text-neutral-600 dark:text-neutral-400">
                          {s}
                        </td>
                      ))
                    : scrollColumns.map((col, ci) => (
                        <td key={col.key} className="px-2 py-2 text-right tabular-nums text-neutral-600 dark:text-neutral-400">
                          {mockStatValue(i + 1, ci)}
                        </td>
                      ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
