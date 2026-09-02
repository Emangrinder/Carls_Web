// Alphabetical by abbreviation — good enough for a rotating strip; revisit
// if we ever want true alphabetical-by-city ordering.
const TEAMS = [
  'ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE', 'DAL', 'DEN',
  'DET', 'GB', 'HOU', 'IND', 'JAX', 'KC', 'LAC', 'LAR', 'LV', 'MIA',
  'MIN', 'NE', 'NO', 'NYG', 'NYJ', 'PHI', 'PIT', 'SEA', 'SF', 'TB',
  'TEN', 'WAS',
]

function Logo({ team }) {
  return (
    <img
      src={`${import.meta.env.BASE_URL}logos/${team}.png`}
      alt={team}
      className="h-10 w-10 shrink-0 object-contain md:h-12 md:w-12"
    />
  )
}

export default function TeamRibbon() {
  return (
    <div className="flex w-full items-center gap-4 border-b border-neutral-200 bg-white px-4 py-2 dark:border-neutral-800 dark:bg-neutral-950">
      <div className="shrink-0 border-r border-neutral-200 pr-4 dark:border-neutral-800">
        <Logo team="NFL" />
      </div>
      <div className="min-w-0 flex-1 overflow-hidden">
        <div className="flex w-max animate-ribbon gap-8">
          {[...TEAMS, ...TEAMS].map((team, i) => (
            <Logo key={`${team}-${i}`} team={team} />
          ))}
        </div>
      </div>
    </div>
  )
}
