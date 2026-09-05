import { useState } from 'react'

const SEASONS = [2026, 2025, 2024]
const DEFAULT_SEASON = 2025
const WEEKS = Array.from({ length: 18 }, (_, i) => i + 1)

// Which rule-set the table is currently filtered to. These aren't the same
// as the Fantasy Rules page's tags -- some of those (Defense) are split
// further here into the three sub-components the league actually cares
// about comparing (pressure/coverage/turnovers).
const SCORE_CATEGORIES = [
  { key: 'passing', label: 'Passing' },
  { key: 'rushing-receiving', label: 'Rushing/Receiving' },
  { key: 'defense-all', label: 'All Defense' },
  { key: 'defense-pressure', label: 'Defense Pressure', note: 'TFL, QB Hits, Sacks' },
  { key: 'defense-coverage', label: 'Defense Coverage', note: 'Tackles, Assist Tackles, PDs' },
  { key: 'defense-turnovers', label: 'Defense Turnovers', note: 'FF, FR, INT, FR Yds, INT Ret Yds' },
  { key: 'kicking', label: 'Kicking' },
  { key: 'returning', label: 'Returning' },
  { key: 'coach', label: 'Coach' },
]

// Preview-only mock rows -- there's no fantasy-scoring database yet (the
// real version needs a new table built from the Fantasy Rules formulas,
// generalized across whichever roster position actually recorded each
// event). Just enough here to see the shape of the table before that
// work happens. `category` is which SCORE_CATEGORIES button surfaces this
// row -- "defense-all" matches any category starting with "defense-".
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
  { name: 'Andy Reid', legalPosition: 'Head Coach', team: 'KC', category: 'coach', seasonAvg: 6.1 },
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

// Pixel widths/offsets for the frozen columns (logo, last name, avg,
// total) -- sticky-left needs each cell's own cumulative offset and an
// opaque background so scrolled week columns don't show through.
const COL_WIDTHS = { logo: 44, name: 108, avg: 60, total: 64 }
const COL_LEFT = {
  logo: 0,
  name: COL_WIDTHS.logo,
  avg: COL_WIDTHS.logo + COL_WIDTHS.name,
  total: COL_WIDTHS.logo + COL_WIDTHS.name + COL_WIDTHS.avg,
}
const WEEK_COL_WIDTH = 56
const FROZEN_WIDTH = COL_LEFT.total + COL_WIDTHS.total
// table-layout:fixed alone doesn't stop a <table> shrinking below the sum
// of its declared column widths to fit its container -- an explicit total
// width forces it, which is what actually makes the wrapper's
// overflow-x-auto have real excess width to scroll.
const TABLE_WIDTH = FROZEN_WIDTH + WEEK_COL_WIDTH * 18
const FROZEN_TD = 'sticky z-10 bg-neutral-50 dark:bg-neutral-900'

export default function FantasyScoresPage() {
  const [season, setSeason] = useState(DEFAULT_SEASON)
  const [category, setCategory] = useState(SCORE_CATEGORIES[0].key)

  const rows = MOCK_ROWS.filter((r) =>
    category === 'defense-all' ? r.category.startsWith('defense-') : r.category === category,
  )

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
        <table className="border-collapse text-sm" style={{ tableLayout: 'fixed', width: TABLE_WIDTH }}>
          <thead>
            <tr className="border-b border-neutral-200 text-left text-neutral-500 dark:border-neutral-800">
              <th className={`${FROZEN_TD} py-2 font-medium`} style={{ left: COL_LEFT.logo, width: COL_WIDTHS.logo }} />
              <th className={`${FROZEN_TD} py-2 pr-2 font-medium`} style={{ left: COL_LEFT.name, width: COL_WIDTHS.name }}>
                Player
              </th>
              <th className={`${FROZEN_TD} px-2 py-2 text-right font-medium`} style={{ left: COL_LEFT.avg, width: COL_WIDTHS.avg }}>
                Avg
              </th>
              <th
                className={`${FROZEN_TD} px-2 py-2 text-right font-medium`}
                style={{ left: COL_LEFT.total, width: COL_WIDTHS.total, borderRight: '1px solid var(--tw-border-opacity, rgba(0,0,0,0.1))' }}
              >
                Total
              </th>
              {WEEKS.map((w) => (
                <th key={w} className="px-2 py-2 text-right font-medium" style={{ width: WEEK_COL_WIDTH }}>
                  Wk {w}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={4 + WEEKS.length} className="py-6 text-center text-sm text-neutral-400">
                  No preview rows tagged for this category yet.
                </td>
              </tr>
            )}
            {rows.map((r, i) => {
              const weekScores = WEEKS.map((w) => mockWeekScore(i + 1, w))
              const total = Math.round(weekScores.reduce((a, b) => a + b, 0) * 10) / 10
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
                      {lastNameOnly(r.name)}
                    </div>
                    <div className="text-xs text-neutral-400">{r.legalPosition}</div>
                  </td>
                  <td
                    className={`${FROZEN_TD} px-2 py-2 text-right tabular-nums text-neutral-600 dark:text-neutral-400`}
                    style={{ left: COL_LEFT.avg, width: COL_WIDTHS.avg }}
                  >
                    {r.seasonAvg}
                  </td>
                  <td
                    className={`${FROZEN_TD} px-2 py-2 text-right font-semibold tabular-nums text-neutral-900 dark:text-neutral-100`}
                    style={{ left: COL_LEFT.total, width: COL_WIDTHS.total, borderRight: '1px solid rgba(120,120,120,0.25)' }}
                  >
                    {total}
                  </td>
                  {weekScores.map((s, wi) => (
                    <td key={wi} className="px-2 py-2 text-right tabular-nums text-neutral-600 dark:text-neutral-400">
                      {s}
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
