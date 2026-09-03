// The `teams` table carries a few historical/relocated duplicate rows
// (LAR, OAK, SD, STL) alongside their current abbreviations (LA, LV, LAC) --
// same team, old code, still present in nflverse's own reference data. This
// is the single list of the 32 currently-active abbreviations, used to
// filter those out anywhere teams are listed.
export const CURRENT_TEAMS = [
  'ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE', 'DAL', 'DEN',
  'DET', 'GB', 'HOU', 'IND', 'JAX', 'KC', 'LA', 'LAC', 'LV', 'MIA',
  'MIN', 'NE', 'NO', 'NYG', 'NYJ', 'PHI', 'PIT', 'SEA', 'SF', 'TB',
  'TEN', 'WAS',
]
