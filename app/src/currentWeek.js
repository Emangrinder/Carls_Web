// Shared "what's the current week" logic -- originally lived only in
// TeamRibbon (for the ribbon's game strip), now also used by MatchesPage
// (default season/week) and NFLMatchupPage (which week's games to show).
//
// "Current week" = whichever (season, week) has the game closest to right
// now -- works whether that week is upcoming or just finished, and needs
// no explicit "today's date is between these two weeks" table to maintain.
export function findCurrentWeek(games) {
  if (!games || games.length === 0) return null
  const kickoffMs = (g) => new Date(`${g.gameday}T${g.gametime || '13:00'}:00`).getTime()
  const now = Date.now()
  let closest = games[0]
  let closestDiff = Infinity
  for (const g of games) {
    const diff = Math.abs(kickoffMs(g) - now)
    if (diff < closestDiff) {
      closestDiff = diff
      closest = g
    }
  }
  return { season: closest.season, week: closest.week }
}

export function kickoffMs(game) {
  return new Date(`${game.gameday}T${game.gametime || '13:00'}:00`).getTime()
}
