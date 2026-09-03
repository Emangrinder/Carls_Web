import { Link } from 'react-router-dom'
import { CURRENT_TEAMS } from './constants'

// Alphabetical by abbreviation — good enough for a rotating strip; revisit
// if we ever want true alphabetical-by-city ordering.
const TEAMS = [...CURRENT_TEAMS].sort()

function Logo({ team, className = '' }) {
  return (
    <img
      src={`${import.meta.env.BASE_URL}logos/${team}.png`}
      alt={team}
      className={`h-10 w-10 shrink-0 object-contain md:h-12 md:w-12 ${className}`}
    />
  )
}

export default function TeamRibbon() {
  return (
    <div className="flex w-full items-center gap-4 border-b border-neutral-200 bg-white px-4 py-2 dark:border-neutral-800 dark:bg-neutral-950">
      <Link to="/" className="shrink-0 pr-4">
        <Logo team="NFL" />
      </Link>
      <Link
        to="/matches"
        className="shrink-0 border-r border-neutral-200 pr-4 text-sm font-medium text-neutral-600 hover:text-neutral-900 dark:border-neutral-800 dark:text-neutral-300 dark:hover:text-neutral-100"
      >
        Matches
      </Link>
      <div
        className="min-w-0 flex-1 overflow-hidden"
        style={{
          maskImage:
            'linear-gradient(to right, transparent, black 48px, black calc(100% - 48px), transparent)',
          WebkitMaskImage:
            'linear-gradient(to right, transparent, black 48px, black calc(100% - 48px), transparent)',
        }}
      >
        <div className="flex w-max animate-ribbon">
          {[...TEAMS, ...TEAMS].map((team, i) => (
            <Link key={`${team}-${i}`} to={`/team/${team}`} className="mr-8 shrink-0">
              <Logo team={team} />
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
