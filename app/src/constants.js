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

// Approximate official primary/secondary brand colors, used only for a
// faint decorative background tint -- not pixel-accurate brand swatches.
export const TEAM_COLORS = {
  ARI: { primary: '#97233F', secondary: '#FFB612' },
  ATL: { primary: '#A71930', secondary: '#A5ACAF' },
  BAL: { primary: '#241773', secondary: '#9E7C0C' },
  BUF: { primary: '#00338D', secondary: '#C60C30' },
  CAR: { primary: '#0085CA', secondary: '#101820' },
  CHI: { primary: '#0B162A', secondary: '#C83803' },
  CIN: { primary: '#FB4F14', secondary: '#000000' },
  CLE: { primary: '#311D00', secondary: '#FF3C00' },
  DAL: { primary: '#003594', secondary: '#869397' },
  DEN: { primary: '#FB4F14', secondary: '#002244' },
  DET: { primary: '#0076B6', secondary: '#B0B7BC' },
  GB: { primary: '#203731', secondary: '#FFB612' },
  HOU: { primary: '#03202F', secondary: '#A71930' },
  IND: { primary: '#002C5F', secondary: '#A2AAAD' },
  JAX: { primary: '#101820', secondary: '#D7A22A' },
  KC: { primary: '#E31837', secondary: '#FFB81C' },
  LA: { primary: '#003594', secondary: '#FFA300' },
  LAC: { primary: '#0080C6', secondary: '#FFC20E' },
  LV: { primary: '#000000', secondary: '#A5ACAF' },
  MIA: { primary: '#008E97', secondary: '#FC4C02' },
  MIN: { primary: '#4F2683', secondary: '#FFC62F' },
  NE: { primary: '#002244', secondary: '#C60C30' },
  NO: { primary: '#D3BC8D', secondary: '#101820' },
  NYG: { primary: '#0B2265', secondary: '#A71930' },
  NYJ: { primary: '#125740', secondary: '#000000' },
  PHI: { primary: '#004C54', secondary: '#A5ACAF' },
  PIT: { primary: '#FFB612', secondary: '#101820' },
  SEA: { primary: '#002244', secondary: '#69BE28' },
  SF: { primary: '#AA0000', secondary: '#B3995D' },
  TB: { primary: '#D50A0A', secondary: '#FF7900' },
  TEN: { primary: '#0C2340', secondary: '#4B92DB' },
  WAS: { primary: '#5A1414', secondary: '#FFB612' },
}
