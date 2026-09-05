import { useState } from 'react'

const SEASONS = [2026, 2025, 2024]
const DEFAULT_SEASON = 2025
const WEEKS = Array.from({ length: 18 }, (_, i) => i + 1)

// Two-level toggle: pick a top-level group, then (for anything but Weeks)
// which of its rule-sets to view. Each leaf's key is what MOCK_ROWS.category
// and STAT_COLUMNS are keyed by. "Coaching > Defense/Offense" are the team-
// level Defensive/Offensive Coordinator stats, not the individual IDP
// Defense group -- kept as coach-defense/coach-offense so they don't
// collide with the top-level Defense group's own leaves.
const TOP_CATEGORIES = [
  { key: 'weeks', label: 'Weeks' },
  {
    key: 'offense',
    label: 'Offense',
    subs: [
      { key: 'passing', label: 'Passing' },
      { key: 'receiving', label: 'Receiving' },
      { key: 'rushing', label: 'Rushing' },
      { key: 'blocking-bonus', label: 'Blocking Bonus' },
    ],
  },
  {
    key: 'defense',
    label: 'Defense',
    subs: [
      { key: 'pressure', label: 'Pressure', note: 'TFL, QB Hits, Sacks' },
      { key: 'coverage', label: 'Coverage', note: 'Tackles, Assist Tackles, PDs' },
      { key: 'turnover', label: 'Turnover', note: 'FF, FR, INT, FR Yds, INT Ret Yds' },
    ],
  },
  {
    key: 'coaching',
    label: 'Coaching',
    subs: [
      { key: 'coach-head', label: 'Head' },
      { key: 'coach-defense', label: 'Defense' },
      { key: 'coach-offense', label: 'Offense' },
    ],
  },
  {
    key: 'special',
    label: 'Special',
    subs: [
      { key: 'kicking', label: 'Kicking' },
      { key: 'punting', label: 'Punting' },
      { key: 'returning', label: 'Returning' },
    ],
  },
]

// The underlying counting stats shown per leaf category -- these feed
// that category's fantasy points, per Fantasy Rules.
const STAT_COLUMNS = {
  passing: [
    { key: 'comp', label: 'Comp' },
    { key: 'att', label: 'Att' },
    { key: 'yds', label: 'Yds' },
    { key: 'td', label: 'TD' },
    { key: 'int', label: 'INT' },
  ],
  receiving: [
    { key: 'rec', label: 'Rec' },
    { key: 'targets', label: 'Targets' },
    { key: 'yds', label: 'Yds' },
    { key: 'td', label: 'TD' },
  ],
  rushing: [
    { key: 'att', label: 'Att' },
    { key: 'yds', label: 'Yds' },
    { key: 'td', label: 'TD' },
  ],
  'blocking-bonus': [
    { key: 'avgPassComp', label: 'Avg/Comp' },
    { key: 'avgRush', label: 'Avg/Rush' },
    { key: 'rushAtt', label: 'Rush Att' },
    { key: 'avgRec', label: 'Avg/Rec' },
  ],
  pressure: [
    { key: 'tfl', label: 'TFL' },
    { key: 'qbHits', label: 'QB Hits' },
    { key: 'sacks', label: 'Sacks' },
  ],
  coverage: [
    { key: 'tkl', label: 'Tackles' },
    { key: 'ast', label: 'Assists' },
    { key: 'pd', label: 'PD' },
  ],
  turnover: [
    { key: 'ff', label: 'FF' },
    { key: 'fr', label: 'FR' },
    { key: 'int', label: 'INT' },
    { key: 'frYds', label: 'FR Yds' },
    { key: 'intYds', label: 'INT Ret Yds' },
  ],
  'coach-head': [
    { key: 'won', label: 'Won' },
    { key: 'lost', label: 'Lost' },
    { key: 'tied', label: 'Tied' },
    { key: 'ptDiff', label: 'Pt Diff' },
  ],
  'coach-defense': [
    { key: 'oppPassTd', label: 'Opp Pass TD' },
    { key: 'oppRushTd', label: 'Opp Rush TD' },
    { key: 'sacks', label: 'Sacks' },
    { key: 'int', label: 'INT' },
    { key: 'passYdsAllowed', label: 'Pass Yds Allowed' },
    { key: 'rushYdsAllowed', label: 'Rush Yds Allowed' },
  ],
  'coach-offense': [
    { key: 'passTd', label: 'Pass TD' },
    { key: 'rushTd', label: 'Rush TD' },
    { key: 'fgMade', label: 'FG Made' },
    { key: 'firstDowns', label: 'First Downs' },
    { key: 'fumblesLost', label: 'Fumbles Lost' },
  ],
  kicking: [
    { key: 'fgMade', label: 'FG Made' },
    { key: 'fgAtt', label: 'FG Att' },
    { key: 'xpMade', label: 'XP Made' },
  ],
  punting: [
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
}

// Preview-only mock rows -- there's no fantasy-scoring database yet (the
// real version needs a new table built from the Fantasy Rules formulas,
// generalized across whichever roster position actually recorded each
// event). Just enough here to see the shape of the table before that
// work happens. `category` is the leaf key from TOP_CATEGORIES[*].subs
// that surfaces this row. `isTeam` rows (Coaching > Defense/Offense) show
// the full team name, not a player's last name.
const MOCK_ROWS = [
  { name: 'Josh Allen', legalPosition: 'QB', team: 'BUF', category: 'passing', seasonAvg: 24.8 },
  { name: 'Saquon Barkley', legalPosition: 'IDP/Skill', team: 'PHI', category: 'rushing', seasonAvg: 21.3 },
  { name: "Ja'Marr Chase", legalPosition: 'IDP/Skill', team: 'CIN', category: 'receiving', seasonAvg: 19.6 },
  { name: 'Travis Kelce', legalPosition: 'IDP/Skill', team: 'KC', category: 'receiving', seasonAvg: 15.2 },
  { name: 'Kyle Juszczyk', legalPosition: 'IDP/Skill', team: 'SF', category: 'blocking-bonus', seasonAvg: 4.3 },
  { name: 'Myles Garrett', legalPosition: 'IDP/Skill', team: 'CLE', category: 'pressure', seasonAvg: 12.7 },
  { name: 'Fred Warner', legalPosition: 'IDP/Skill', team: 'SF', category: 'coverage', seasonAvg: 13.9 },
  { name: 'Patrick Surtain II', legalPosition: 'IDP/Skill', team: 'DEN', category: 'turnover', seasonAvg: 11.1 },
  { name: 'Andy Reid', legalPosition: 'Head Coach', team: 'KC', category: 'coach-head', seasonAvg: 6.1 },
  { name: 'Buffalo Bills', legalPosition: 'Def', team: 'BUF', category: 'coach-defense', seasonAvg: 14.2, isTeam: true },
  { name: 'Kansas City Chiefs', legalPosition: 'ST', team: 'KC', category: 'coach-offense', seasonAvg: 16.8, isTeam: true },
  { name: 'Justin Tucker', legalPosition: 'PK', team: 'BAL', category: 'kicking', seasonAvg: 9.4 },
  { name: 'AJ Cole', legalPosition: 'PN', team: 'LV', category: 'punting', seasonAvg: 7.6 },
  { name: 'KaVontae Turpin', legalPosition: 'IDP/Skill', team: 'DAL', category: 'returning', seasonAvg: 8.2 },
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

function ToggleButton({ active, onClick, children, title }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
        active
          ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900'
          : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700'
      }`}
    >
      {children}
    </button>
  )
}

export default function FantasyScoresPage() {
  const [season, setSeason] = useState(DEFAULT_SEASON)
  const [topKey, setTopKey] = useState('weeks')
  const [subKey, setSubKey] = useState(null)

  const topCategory = TOP_CATEGORIES.find((c) => c.key === topKey)
  const isWeeks = topKey === 'weeks'
  const activeSub = isWeeks ? null : subKey ?? topCategory.subs[0].key

  function selectTop(key) {
    setTopKey(key)
    const cat = TOP_CATEGORIES.find((c) => c.key === key)
    setSubKey(cat.subs ? cat.subs[0].key : null)
  }

  const rows = isWeeks ? MOCK_ROWS : MOCK_ROWS.filter((r) => r.category === activeSub)
  const scrollColumns = isWeeks ? WEEKS.map((w) => ({ key: w, label: `Wk ${w}` })) : STAT_COLUMNS[activeSub]
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

      <div className="mb-1.5 flex flex-wrap gap-1.5">
        {TOP_CATEGORIES.map((c) => (
          <ToggleButton key={c.key} active={topKey === c.key} onClick={() => selectTop(c.key)}>
            {c.label}
          </ToggleButton>
        ))}
      </div>

      {!isWeeks && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {topCategory.subs.map((s) => (
            <ToggleButton key={s.key} active={activeSub === s.key} onClick={() => setSubKey(s.key)} title={s.note}>
              {s.label}
            </ToggleButton>
          ))}
        </div>
      )}
      {isWeeks && <div className="mb-4" />}

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
              const weekScores = isWeeks ? WEEKS.map((w) => mockWeekScore(i + 1, w)) : null
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
                  {isWeeks
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
