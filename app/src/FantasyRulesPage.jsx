import { RULE_GROUPS, UNIVERSAL_TAGS, INDEPENDENT_TAGS, STARTING_LINEUP, IR_SLOTS, RESERVE_SLOTS } from './fantasyRulesData'

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
  return (
    <div className="mb-6 rounded-lg border border-neutral-200 dark:border-neutral-800">
      <div className="flex flex-wrap items-center gap-2 border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
        <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{group.title}</h3>
        <TagPill tag={group.tag} independent={group.independent} />
        {group.independent && (
          <span className="text-xs text-neutral-400">independent -- doesn't apply outside this role</span>
        )}
      </div>
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
                <td className="px-4 py-1.5 text-neutral-700 dark:text-neutral-300">
                  {r.event}
                  {r.test && <span className="ml-1.5 text-[10px] text-yellow-600 dark:text-yellow-500">({r.test})</span>}
                </td>
                <td className="px-2 py-1.5 tabular-nums text-neutral-500">{r.range}</td>
                <td className="px-2 py-1.5 text-neutral-900 dark:text-neutral-100">{r.points}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
        group is named after (a TE who throws a touchdown pass earns the QB group's passing-TD points,
        a RB who makes a tackle earns the IDP Defense group's tackle points, and so on). The only
        exceptions are <span className="font-medium text-neutral-700 dark:text-neutral-300">Coach</span>,{' '}
        <span className="font-medium text-neutral-700 dark:text-neutral-300">ST</span>, and{' '}
        <span className="font-medium text-neutral-700 dark:text-neutral-300">DEF</span> -- those three are
        tied to their own dedicated roster slot and never apply to anyone else.
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

      <div className="mb-8 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-400">
          Legal Starting Lineup
        </h2>
        <ul className="mb-3 grid grid-cols-1 gap-1.5 text-sm sm:grid-cols-2">
          {STARTING_LINEUP.map((s) => (
            <li key={s.slot} className="flex justify-between gap-2 border-b border-neutral-100 py-1 dark:border-neutral-900">
              <span className="text-neutral-700 dark:text-neutral-300">{s.slot}</span>
              <span className="font-medium text-neutral-900 dark:text-neutral-100">{s.count}</span>
            </li>
          ))}
        </ul>
        <div className="flex gap-6 text-sm text-neutral-500">
          <span>
            IR slots: <span className="font-medium text-neutral-900 dark:text-neutral-100">{IR_SLOTS}</span>
          </span>
          <span>
            Reserve slots: <span className="font-medium text-neutral-900 dark:text-neutral-100">{RESERVE_SLOTS}</span>
          </span>
        </div>
      </div>

      {RULE_GROUPS.map((group) => (
        <RuleGroupTable key={group.tag} group={group} />
      ))}
    </div>
  )
}
