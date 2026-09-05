import { useState } from 'react'
import {
  RULE_GROUPS,
  UNIVERSAL_TAGS,
  INDEPENDENT_TAGS,
  STARTING_LINEUP_ROWS,
  ROSTER_LIMITS,
} from './fantasyRulesData'

function TagPill({ tag, independent }) {
  return (
    <span
      className={`rounded-full px-3 py-1 text-xs font-medium ${
        independent
          ? 'bg-neutral-200 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300'
          : 'bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300'
      }`}
    >
      {tag}
    </span>
  )
}

function RuleGroupTable({ group }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="mb-4 rounded-lg border border-neutral-200 dark:border-neutral-800">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        className="flex w-full flex-wrap items-center gap-2 px-4 py-3 text-left"
      >
        <span className={`text-xs text-neutral-400 transition-transform ${expanded ? 'rotate-90' : ''}`}>▶</span>
        <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{group.tag}</h3>
        <TagPill tag={group.independent ? 'independent' : 'universal'} independent={group.independent} />
      </button>
      {expanded && (
        <div className="border-t border-neutral-200 dark:border-neutral-800">
          {group.subtitle && (
            <p className="px-4 pt-3 text-xs italic text-neutral-400">{group.subtitle}</p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[500px] text-sm">
              <thead>
                <tr className="border-b border-neutral-200 text-left text-xs text-neutral-400 dark:border-neutral-800">
                  <th className="px-4 py-2 font-medium">Event</th>
                  <th className="px-2 py-2 font-medium">Range (Low-High)</th>
                  <th className="px-2 py-2 font-medium">Points</th>
                </tr>
              </thead>
              <tbody>
                {group.rules.map((r, i) => (
                  <tr key={i} className="border-b border-neutral-100 last:border-0 dark:border-neutral-900">
                    <td className="px-4 py-1.5 text-neutral-700 dark:text-neutral-300">{r.event}</td>
                    <td className="px-2 py-1.5 tabular-nums text-neutral-500">{r.range}</td>
                    <td className="px-2 py-1.5 text-neutral-900 dark:text-neutral-100">{r.points}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function LineupRow({ cells }) {
  return (
    <div className="grid grid-cols-2 border-b border-neutral-100 last:border-0 dark:border-neutral-900">
      {cells.map((c, i) => (
        <div
          key={c.label}
          className={`flex justify-between gap-2 px-3 py-2 ${
            cells.length === 1 ? 'col-span-2' : i === 0 ? 'border-r border-neutral-100 dark:border-neutral-900' : ''
          }`}
        >
          <span className="text-neutral-700 dark:text-neutral-300">{c.label}</span>
          <span className="font-medium text-neutral-900 dark:text-neutral-100">{c.count}</span>
        </div>
      ))}
    </div>
  )
}

export default function FantasyRulesPage() {
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6">
      <h1 className="mb-2 text-2xl font-semibold text-neutral-900 dark:text-neutral-100">Fantasy Rules</h1>
      <p className="mb-6 max-w-2xl text-sm text-neutral-500">
        The league's custom scoring rules. Every rule group below is <span className="font-medium text-neutral-700 dark:text-neutral-300">universal</span> --
        it scores for whichever roster player actually records the event, not just the position the
        group used to be drawn up around (a TE who throws a touchdown pass earns Passing's points, a
        RB who makes a tackle earns Defense's tackle points, and so on). The only exceptions are{' '}
        <span className="font-medium text-neutral-700 dark:text-neutral-300">Head Coach</span>,{' '}
        <span className="font-medium text-neutral-700 dark:text-neutral-300">Offensive Coordinator</span>, and{' '}
        <span className="font-medium text-neutral-700 dark:text-neutral-300">Defensive Coordinator</span> -- those
        three are tied to their own dedicated roster slot (ST and Def, respectively) and never apply to anyone else.
      </p>

      <div className="mb-8 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
          Applies to all positions
        </h2>
        <div className="mb-3 flex flex-wrap gap-2">
          {UNIVERSAL_TAGS.map((tag) => (
            <TagPill key={tag} tag={tag} />
          ))}
        </div>
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
          Independent (own roster slot only)
        </h2>
        <div className="flex flex-wrap gap-2">
          {INDEPENDENT_TAGS.map((tag) => (
            <TagPill key={tag} tag={tag} independent />
          ))}
        </div>
      </div>

      <div className="mb-8 rounded-lg border border-neutral-200 dark:border-neutral-800">
        <h2 className="px-4 pt-3 text-xs font-semibold uppercase tracking-wide text-neutral-400">
          Legal Starting Lineup
        </h2>
        <div className="mt-2">
          {STARTING_LINEUP_ROWS.map((row, i) => (
            <LineupRow key={i} cells={row} />
          ))}
        </div>
      </div>

      {RULE_GROUPS.map((group) => (
        <RuleGroupTable key={group.tag} group={group} />
      ))}

      <div className="mt-8 rounded-lg border border-neutral-200 dark:border-neutral-800">
        <h2 className="px-4 pt-3 text-xs font-semibold uppercase tracking-wide text-neutral-400">
          Roster Position Limits
        </h2>
        <table className="mt-2 w-full text-sm">
          <tbody>
            {ROSTER_LIMITS.map((r) => (
              <tr key={r.position} className="border-b border-neutral-100 last:border-0 dark:border-neutral-900">
                <td className="px-4 py-1.5 text-neutral-700 dark:text-neutral-300">Number of {r.position} on Roster</td>
                <td className="px-4 py-1.5 text-right font-medium text-neutral-900 dark:text-neutral-100">{r.range}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
