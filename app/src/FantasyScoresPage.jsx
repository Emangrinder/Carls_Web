import { useState } from 'react'

const SEASONS = [2026, 2025, 2024]
const DEFAULT_SEASON = 2025
const WEEKS = Array.from({ length: 18 }, (_, i) => i + 1)

// Preview-only mock rows -- there's no fantasy-scoring database yet (the
// real version needs a new table built from the Fantasy Rules formulas,
// generalized across whichever roster position actually recorded each
// event). Just enough here to see the shape of the table before that
// work happens.
const MOCK_ROWS = [
  { name: 'Josh Allen', legalPosition: 'QB', team: 'BUF', seasonAvg: 24.8 },
  { name: 'Saquon Barkley', legalPosition: 'IDP/Skill', team: 'PHI', seasonAvg: 21.3 },
  { name: 'Ja\'Marr Chase', legalPosition: 'IDP/Skill', team: 'CIN', seasonAvg: 19.6 },
  { name: 'Travis Kelce', legalPosition: 'IDP/Skill', team: 'KC', seasonAvg: 15.2 },
  { name: 'Justin Tucker', legalPosition: 'PK', team: 'BAL', seasonAvg: 9.4 },
  { name: 'Myles Garrett', legalPosition: 'IDP/Skill', team: 'CLE', seasonAvg: 12.7 },
  { name: 'Andy Reid', legalPosition: 'Head Coach', team: 'KC', seasonAvg: 6.1 },
]

function mockWeekScore(seed, week) {
  // Deterministic pseudo-random placeholder so reloading doesn't jitter.
  const n = Math.sin(seed * 999 + week) * 10000
  return Math.round(((n - Math.floor(n)) * 20 + 2) * 10) / 10
}

export default function FantasyScoresPage() {
  const [season, setSeason] = useState(DEFAULT_SEASON)

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

      <div className="mb-4 rounded border border-yellow-300 bg-yellow-50 px-3 py-2 text-xs text-yellow-800 dark:border-yellow-800 dark:bg-yellow-950/30 dark:text-yellow-400">
        Preview data below -- not real scores yet.
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[1400px] border-collapse text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-neutral-500 dark:border-neutral-800">
              <th className="py-2 pr-2 font-medium">Player</th>
              <th className="px-2 py-2 text-right font-medium">Season Avg</th>
              <th className="px-2 py-2 font-medium">Team</th>
              {WEEKS.map((w) => (
                <th key={w} className="px-2 py-2 text-right font-medium">
                  Wk {w}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MOCK_ROWS.map((r, i) => (
              <tr key={r.name} className="border-b border-neutral-100 dark:border-neutral-900">
                <td className="py-2 pr-2">
                  <div className="font-medium text-neutral-900 dark:text-neutral-100">{r.name}</div>
                  <div className="text-xs text-neutral-400">{r.legalPosition}</div>
                </td>
                <td className="px-2 py-2 text-right font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">
                  {r.seasonAvg}
                </td>
                <td className="px-2 py-2">
                  <img
                    src={`${import.meta.env.BASE_URL}logos/${r.team}.png`}
                    alt={r.team}
                    className="h-6 w-6 object-contain"
                  />
                </td>
                {WEEKS.map((w) => (
                  <td key={w} className="px-2 py-2 text-right tabular-nums text-neutral-600 dark:text-neutral-400">
                    {mockWeekScore(i + 1, w)}
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
