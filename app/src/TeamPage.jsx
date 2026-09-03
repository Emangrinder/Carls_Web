import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from './supabaseClient'
import { TEAM_COLORS } from './constants'
import LoadingSpinner from './LoadingSpinner'

const SEASONS = [2026, 2025, 2024]
const DEFAULT_SEASON = 2025
// The depth-chart hover card's stats always look back at the most recent
// *completed* season, independent of the season-toggle above the schedule
// -- the depth chart itself (from depth_chart_ranks) has no season
// dimension, it's always "right now," so its stats popup needs a fixed
// reference season rather than following whichever season tab is active.
const STATS_SEASON = 2025
const WEEKS_PART1 = Array.from({ length: 9 }, (_, i) => i + 1) // 1-9
const WEEKS_PART2 = Array.from({ length: 9 }, (_, i) => i + 10) // 10-18
const POSTSEASON_LABELS = { WC: 'WC', DIV: 'DIV', CON: 'CONF', SB: 'SB' }

function fmtDiff(n) {
  if (n == null) return '—'
  return n > 0 ? `+${n}` : `${n}`
}

function fmtAvg(n) {
  return n == null ? '—' : n.toFixed(1)
}

function fmtPct(n) {
  return n == null ? '—' : `${n}%`
}

function fmtCount(n) {
  return n ?? '—'
}

// Each row renders its own For/Against pair from the full stats row, so a
// row can combine multiple underlying columns (e.g. interceptions+fumbles
// into one "Turnovers [I/F]" line) instead of always being one column each.
const STAT_ROWS = [
  { label: 'Rush Yds Avg', render: (s) => [fmtAvg(s.rush_yds_avg), fmtAvg(s.rush_yds_allowed_avg)] },
  { label: 'Pass Yds Avg', render: (s) => [fmtAvg(s.pass_yds_avg), fmtAvg(s.pass_yds_allowed_avg)] },
  {
    label: 'Turnovers [I/F]',
    render: (s) => [
      `${fmtCount(s.turnovers_int)}/${fmtCount(s.turnovers_fumble)}`,
      `${fmtCount(s.takeaways_int)}/${fmtCount(s.takeaways_fumble)}`,
    ],
  },
  {
    label: 'Pass/Rush TD',
    render: (s) => [
      `${fmtCount(s.pass_td)}/${fmtCount(s.rush_td)}`,
      `${fmtCount(s.pass_td_allowed)}/${fmtCount(s.rush_td_allowed)}`,
    ],
  },
  {
    label: 'Sacks/QB Hits',
    render: (s) => [
      `${fmtCount(s.sacks)}/${fmtCount(s.qb_hits)}`,
      `${fmtCount(s.sacks_allowed)}/${fmtCount(s.qb_hits_allowed)}`,
    ],
  },
  { label: 'Punts Avg', render: (s) => [fmtAvg(s.punts_avg), fmtAvg(s.punts_allowed_avg)] },
  { label: 'Punt Return %', render: (s) => [fmtPct(s.punt_return_pct_for), fmtPct(s.punt_return_pct_against)] },
  { label: 'Kick Return Yds Avg', render: (s) => [fmtAvg(s.kick_return_yards_avg), fmtAvg(s.kick_return_yards_allowed_avg)] },
  { label: 'Punt Return Yds Avg', render: (s) => [fmtAvg(s.punt_return_yards_avg), fmtAvg(s.punt_return_yards_allowed_avg)] },
  { label: 'Offensive Snaps Avg', render: (s) => [fmtAvg(s.offense_snaps_avg), fmtAvg(s.offense_snaps_allowed_avg)] },
  { label: 'Defensive Snaps Avg', render: (s) => [fmtAvg(s.defense_snaps_avg), fmtAvg(s.defense_snaps_allowed_avg)] },
]

// Maps a depth chart position_abbr to a stable category, independent of
// each team's own (inconsistently named) position_group formation labels.
const POSITION_CATEGORY = {
  QB: 'qb',
  LT: 'ol', LG: 'ol', C: 'ol', RG: 'ol', RT: 'ol',
  RB: 'skill', WR: 'skill', TE: 'skill', FB: 'skill',
  LDE: 'dl', RDE: 'dl', DE: 'dl', NT: 'dl', DT: 'dl', LDT: 'dl', RDT: 'dl',
  WLB: 'lb', SLB: 'lb', MLB: 'lb', LILB: 'lb', RILB: 'lb', ILB: 'lb', OLB: 'lb',
  LCB: 'cb', RCB: 'cb', CB: 'cb', NB: 'cb',
  FS: 's', SS: 's', S: 's',
  PK: 'st', P: 'st', KR: 'st', PR: 'st', LS: 'st', H: 'st',
}
// Injury status colors, shared between the starter tiles (background) and
// the bottom depth list (font color) -- keys match current_injury_report's
// own report_status values verbatim.
const INJURY_STATUS_STYLES = {
  Out: {
    chip: 'border-red-400 bg-red-50 dark:border-red-700 dark:bg-red-950/40',
    text: 'text-red-600 dark:text-red-400',
    swatch: 'border-red-400 bg-red-50 dark:border-red-700 dark:bg-red-950/40',
  },
  Doubtful: {
    chip: 'border-orange-400 bg-orange-50 dark:border-orange-700 dark:bg-orange-950/40',
    text: 'text-orange-600 dark:text-orange-400',
    swatch: 'border-orange-400 bg-orange-50 dark:border-orange-700 dark:bg-orange-950/40',
  },
  Questionable: {
    chip: 'border-yellow-400 bg-yellow-50 dark:border-yellow-700 dark:bg-yellow-950/40',
    text: 'text-yellow-600 dark:text-yellow-500',
    swatch: 'border-yellow-400 bg-yellow-50 dark:border-yellow-700 dark:bg-yellow-950/40',
  },
}

const OL_ORDER = ['LT', 'LG', 'C', 'RG', 'RT']
// Left-to-right field order for position groups where the depth chart's
// side-specific abbreviations (L*/R*) tell us how they'd actually line up.
// Generic/no-side abbreviations (DE, DT, CB...) fall back to a middle slot.
const DL_ORDER = ['LDE', 'LDT', 'NT', 'DT', 'RDT', 'RDE']
// Sam (strong-side) and Will (weak-side) linebackers are the two edge LBs,
// with the inside/Mike backers between them -- SLB and WLB on opposite
// outsides per the user's explicit callout, not both crowded together.
const LB_ORDER = ['WLB', 'LILB', 'MLB', 'ILB', 'RILB', 'SLB']
const CB_ORDER = ['LCB', 'NB', 'RCB']

function sortByFieldOrder(players, order) {
  const mid = order.length / 2
  const indexOf = (p) => {
    const i = order.indexOf(p.position_abbr)
    return i === -1 ? mid : i
  }
  return [...players].sort((a, b) => indexOf(a) - indexOf(b))
}

const KICKING_STARTER_ABBRS = ['PK', 'P']
const RETURN_STARTER_ABBRS = ['KR', 'PR']
// Skill positions where more than one depth slot is part of the base
// personnel package, not just the #1 -- e.g. most offenses roll with 2+ WRs.
const SKILL_STARTER_MAX_RANK = { RB: 2, WR: 3, TE: 2, FB: 1 }
const SKILL_ORDER = ['RB', 'WR', 'TE', 'FB']

function categoryOf(p) {
  return POSITION_CATEGORY[p.position_abbr] ?? 'other'
}

function isSkillStarter(p) {
  const maxRank = SKILL_STARTER_MAX_RANK[p.position_abbr]
  return maxRank != null && p.rank <= maxRank
}

// Sums the given numeric fields per player_id across every row -- a player
// traded mid-season has one stat row per team, so a single row lookup
// would silently miss whatever they did before/after the trade.
function aggregateRowsByPlayer(rows, fields) {
  const out = new Map()
  for (const row of rows) {
    const acc = out.get(row.player_id) ?? Object.fromEntries(fields.map((f) => [f, 0]))
    for (const f of fields) acc[f] += row[f] ?? 0
    out.set(row.player_id, acc)
  }
  return out
}

function fmtStat(n, digits = 0) {
  return n == null || Number.isNaN(n) ? '—' : n.toFixed(digits)
}

// The depth chart hover card's two position-specific stats, per the exact
// formulas requested: prior-season pass yards/game for QBs, team carry/
// target share for RB/WR/TE, snap-share-vs-the-current-team's-prior-year
// total for OL (so a trade shows e.g. "800/900" -- their own snaps over
// this team's total, not their old team's), pressure/tackle/coverage
// tallies for the front seven and secondary, and simple counting stats
// for specialists.
function computeStatLines(p, popupData) {
  const { offenseByPlayer, defenseByPlayer, stByPlayer, snapByPlayer, shareByPlayer, teamPriorOffenseSnaps } = popupData
  const off = offenseByPlayer.get(p.player_id)
  const def = defenseByPlayer.get(p.player_id)
  const st = stByPlayer.get(p.player_id)
  const snaps = snapByPlayer.get(p.player_id)
  const share = shareByPlayer.get(p.player_id)
  const category = categoryOf(p)

  switch (category) {
    case 'qb': {
      const avg = off && off.games ? off.passing_yards / off.games : null
      return [{ label: `${STATS_SEASON} Pass Yds/G`, value: fmtStat(avg, 1) }]
    }
    case 'ol': {
      const own = snaps?.offense_snaps ?? 0
      return [{
        label: `${STATS_SEASON} Snap Share`,
        value: teamPriorOffenseSnaps ? `${own}/${teamPriorOffenseSnaps}` : '—',
      }]
    }
    case 'skill': {
      if (p.position_abbr === 'RB') {
        return [{ label: 'Team Carry %', value: share?.team_rb_carry_pct != null ? `${share.team_rb_carry_pct}%` : '—' }]
      }
      if (p.position_abbr === 'WR' || p.position_abbr === 'TE') {
        return [{ label: 'Team Target %', value: share?.team_target_pct != null ? `${share.team_target_pct}%` : '—' }]
      }
      return []
    }
    case 'dl': {
      const val = def ? (def.def_sacks ?? 0) + (def.def_qb_hits ?? 0) + (def.def_tackles_for_loss ?? 0) : null
      return [{ label: 'Hits+Sacks+TFL', value: fmtStat(val, 1) }]
    }
    case 'lb': {
      const val = def ? (def.def_tackles_solo ?? 0) + (def.def_tackles_with_assist ?? 0) : null
      return [{ label: 'Tackles', value: fmtStat(val) }]
    }
    case 'cb':
    case 's': {
      // PD and INT deliberately double-count (an int is technically also a
      // PD in the raw data, but stacking both values more accurately shows
      // playmaking impact) -- explicit user call, not an oversight.
      const val = def
        ? (def.def_pass_defended ?? 0) + (def.def_interceptions ?? 0) +
          0.5 * ((def.def_tackles_solo ?? 0) + (def.def_tackles_with_assist ?? 0))
        : null
      return [{ label: 'PD+INT+½Tkl', value: fmtStat(val, 1) }]
    }
    case 'st': {
      if (p.position_abbr === 'PK') return [{ label: `${STATS_SEASON} FGs Made`, value: fmtStat(st?.fg_made) }]
      if (p.position_abbr === 'P') {
        const avg = st && st.pt_att ? st.pt_yards / st.pt_att : null
        return [{ label: 'Avg Punt Yds', value: fmtStat(avg, 1) }]
      }
      if (p.position_abbr === 'KR') return [{ label: 'Kick Returns', value: fmtStat(st?.kickoff_returns) }]
      if (p.position_abbr === 'PR') return [{ label: 'Punt Returns', value: fmtStat(st?.punt_returns) }]
      return []
    }
    default:
      return []
  }
}

function snapCountFor(p, popupData) {
  const snaps = popupData.snapByPlayer.get(p.player_id)
  if (!snaps) return null
  const category = categoryOf(p)
  if (category === 'qb' || category === 'ol' || category === 'skill') return snaps.offense_snaps
  if (category === 'dl' || category === 'lb' || category === 'cb' || category === 's') return snaps.defense_snaps
  if (category === 'st') return snaps.st_snaps
  return null
}

// Drops just the first token (first name), keeping the rest -- handles
// suffixes like "Jr."/"III" better than taking only the last token would.
function lastNameOnly(fullName) {
  if (!fullName) return '—'
  const rest = fullName.split(' ').slice(1).join(' ')
  return rest || fullName
}

// Two independent hover popups: a stats card just ABOVE the chip (number,
// snap count, two position-specific stats -- for every player, not just
// injured ones) and a "next up" card just BENEATH it showing the next
// bench player at that exact slot. Kept as plain absolutely-positioned
// siblings of the hovered element itself, so there's no coordinate math --
// they just track whatever they're anchored to.
function PlayerPopups({ number, snapCount, statLines, nextUp }) {
  const hasStats = number != null || snapCount != null || statLines.length > 0
  return (
    <>
      {hasStats && (
        <div className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-1.5 w-max max-w-[170px] -translate-x-1/2 rounded border border-neutral-300 bg-white px-2 py-1.5 text-left text-[11px] leading-tight shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
          <div className="font-semibold text-neutral-900 dark:text-neutral-100">
            #{number ?? '—'} · {snapCount ?? '—'} snaps
          </div>
          {statLines.map((l) => (
            <div key={l.label} className="text-neutral-500">
              {l.label}: <span className="text-neutral-700 dark:text-neutral-300">{l.value}</span>
            </div>
          ))}
        </div>
      )}
      {nextUp && (
        <div className="pointer-events-none absolute top-full left-1/2 z-30 mt-1.5 whitespace-nowrap rounded border border-neutral-300 bg-white px-2 py-1 text-[11px] shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
          Next: {lastNameOnly(nextUp.player_name)}
        </div>
      )}
    </>
  )
}

function PlayerChip({ p, injuryStatus, popupData, findNextUp, onHoverInjured, onUnhoverInjured }) {
  const [hovered, setHovered] = useState(false)
  const style = INJURY_STATUS_STYLES[injuryStatus]
  const className = `shrink-0 whitespace-nowrap rounded border px-2 py-1 text-center text-xs hover:opacity-75 ${
    style ? style.chip : 'border-neutral-200 dark:border-neutral-800'
  }`
  const inner = (
    <>
      <div className="text-[10px] text-neutral-500">
        {p.position_abbr}
        {p.rank > 1 ? p.rank : ''}
      </div>
      <div className="font-medium text-neutral-900 dark:text-neutral-100">
        {lastNameOnly(p.player_name)}
      </div>
    </>
  )
  return (
    <div
      className="relative shrink-0"
      onMouseEnter={() => {
        setHovered(true)
        if (injuryStatus) onHoverInjured?.(p)
      }}
      onMouseLeave={() => {
        setHovered(false)
        if (injuryStatus) onUnhoverInjured?.()
      }}
    >
      {p.player_id ? (
        <Link to={`/player/${p.player_id}`} className={className}>{inner}</Link>
      ) : p.player_name ? (
        // Rookies without a gsis_id yet (nflverse hasn't crosswalked them into
        // `players`) still have college stats -- link by name so PlayerPage
        // can fall back to a college-only profile instead of no page at all.
        <Link to={`/player/name:${encodeURIComponent(p.player_name)}`} className={className}>{inner}</Link>
      ) : (
        <div className={className}>{inner}</div>
      )}
      {hovered && popupData && (
        <PlayerPopups
          number={popupData.numberByPlayer.get(p.player_id)}
          snapCount={snapCountFor(p, popupData)}
          statLines={computeStatLines(p, popupData)}
          nextUp={findNextUp(p)}
        />
      )}
    </div>
  )
}

// Same hover-popup behavior as PlayerChip, just for the bottom bench-list
// row's plain-text visual instead of a bordered chip.
function DepthListItem({ p, injuryStatus, isNextUp, popupData, findNextUp, onHoverInjured, onUnhoverInjured }) {
  const [hovered, setHovered] = useState(false)
  const injuryStyle = INJURY_STATUS_STYLES[injuryStatus]
  return (
    <li
      className={`relative flex justify-between border-b border-neutral-100 py-1 dark:border-neutral-900 ${
        isNextUp ? 'rounded bg-blue-50 ring-1 ring-blue-300 dark:bg-blue-950/40 dark:ring-blue-700' : ''
      }`}
      onMouseEnter={() => {
        setHovered(true)
        if (injuryStatus) onHoverInjured?.(p)
      }}
      onMouseLeave={() => {
        setHovered(false)
        if (injuryStatus) onUnhoverInjured?.()
      }}
    >
      <span className="text-neutral-500">
        {p.position_abbr} #{p.rank}
      </span>
      {p.player_id || p.player_name ? (
        <Link
          to={p.player_id ? `/player/${p.player_id}` : `/player/name:${encodeURIComponent(p.player_name)}`}
          className={`hover:underline ${injuryStyle ? injuryStyle.text : 'text-neutral-900 dark:text-neutral-100'}`}
        >
          {p.player_name ?? '—'}
        </Link>
      ) : (
        <span className={injuryStyle ? injuryStyle.text : 'text-neutral-900 dark:text-neutral-100'}>
          {p.player_name ?? '—'}
        </span>
      )}
      {hovered && popupData && (
        <PlayerPopups
          number={popupData.numberByPlayer.get(p.player_id)}
          snapCount={snapCountFor(p, popupData)}
          statLines={computeStatLines(p, popupData)}
          nextUp={findNextUp(p)}
        />
      )}
    </li>
  )
}

function InjuryLegend() {
  return (
    <div className="mt-6 flex flex-wrap items-center gap-4 text-xs text-neutral-500">
      <span className="font-medium text-neutral-400">Injury status:</span>
      {Object.entries(INJURY_STATUS_STYLES).map(([status, style]) => (
        <span key={status} className="flex items-center gap-1.5">
          <span className={`inline-block h-3 w-3 rounded border ${style.swatch}`} />
          {status}
        </span>
      ))}
    </div>
  )
}

function GameCell({ teamAbbr, game, byeLabel }) {
  if (!game) {
    return (
      <div className="flex flex-col items-center gap-1">
        <img
          src={`${import.meta.env.BASE_URL}logos/NFL.png`}
          alt="Bye"
          className="h-8 w-8 object-contain opacity-50"
        />
        <span className="text-[10px] text-neutral-400">{byeLabel}</span>
        <span className="text-[9px] text-transparent">@</span>
      </div>
    )
  }
  const isHome = game.home_team === teamAbbr
  const opponent = isHome ? game.away_team : game.home_team
  const teamScore = isHome ? game.home_score : game.away_score
  const oppScore = isHome ? game.away_score : game.home_score
  let result = null
  if (teamScore != null && oppScore != null) {
    result = teamScore > oppScore ? 'W' : teamScore < oppScore ? 'L' : 'T'
  }
  const resultColor =
    result === 'W'
      ? 'text-green-600 dark:text-green-400'
      : result === 'L'
        ? 'text-red-600 dark:text-red-400'
        : 'text-neutral-500'
  return (
    <Link to={`/matches/${game.game_id}`} className="flex flex-col items-center gap-1 hover:opacity-75">
      <img
        src={`${import.meta.env.BASE_URL}logos/${opponent}.png`}
        alt={opponent}
        className="h-8 w-8 object-contain"
      />
      <span className={`text-[10px] font-medium ${resultColor}`}>{result ?? '—'}</span>
      <span className="text-[9px] text-neutral-400">{isHome ? ' ' : '@'}</span>
    </Link>
  )
}

const COACH_ROLE_ORDER = ['HC', 'OC', 'DC']
const COACH_ROLE_LABEL = { HC: 'Head Coach', OC: 'Off. Coordinator', DC: 'Def. Coordinator' }

function CoachingStaff({ coaches }) {
  if (coaches.length === 0) return null
  const sorted = [...coaches].sort((a, b) => COACH_ROLE_ORDER.indexOf(a.role) - COACH_ROLE_ORDER.indexOf(b.role))
  return (
    <div className="mb-4 flex flex-wrap gap-x-6 gap-y-2">
      {sorted.map((c) => (
        <div key={c.role}>
          <div className="text-xs text-neutral-500">{COACH_ROLE_LABEL[c.role] ?? c.role}</div>
          <div className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
            {c.coach_name}
            {c.since_year && <span className="ml-1 font-normal text-neutral-400">(since {c.since_year})</span>}
          </div>
        </div>
      ))}
    </div>
  )
}

function StarterRow({ label, players, injuryByPlayerId, popupData, findNextUp, onHoverInjured, onUnhoverInjured }) {
  if (players.length === 0) return null
  return (
    <div className="mb-3">
      <div className="mb-1 text-xs text-neutral-500">{label}</div>
      <div className="flex flex-nowrap justify-center gap-2 overflow-x-auto">
        {players.map((p) => (
          <PlayerChip
            key={`${p.position_name}-${p.position_slot}-${p.rank}`}
            p={p}
            injuryStatus={injuryByPlayerId.get(p.player_id)}
            popupData={popupData}
            findNextUp={findNextUp}
            onHoverInjured={onHoverInjured}
            onUnhoverInjured={onUnhoverInjured}
          />
        ))}
      </div>
    </div>
  )
}

export default function TeamPage() {
  const { teamAbbr } = useParams()
  const [season, setSeason] = useState(DEFAULT_SEASON)
  const [team, setTeam] = useState(null)
  const [stats, setStats] = useState(null)
  const [depthChart, setDepthChart] = useState([])
  const [injuries, setInjuries] = useState([])
  const [games, setGames] = useState([])
  const [coaches, setCoaches] = useState([])
  const [hoveredInjuredPlayer, setHoveredInjuredPlayer] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [popupData, setPopupData] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    Promise.all([
      supabase.from('teams').select('*').eq('team_abbr', teamAbbr).single(),
      supabase.from('team_season_stats').select('*').eq('team', teamAbbr).eq('season', season).maybeSingle(),
      supabase.from('depth_chart_ranks').select('*').eq('team', teamAbbr).order('position_group').order('rank'),
      supabase.from('current_injury_report').select('player_id, report_status').eq('team', teamAbbr),
      supabase
        .from('games')
        .select('*')
        .eq('season', season)
        .or(`home_team.eq.${teamAbbr},away_team.eq.${teamAbbr}`)
        .order('week'),
      supabase.from('current_coaching_staff').select('*').eq('team', teamAbbr),
    ]).then(([teamRes, statsRes, depthRes, injuriesRes, gamesRes, coachesRes]) => {
      if (cancelled) return
      const err = teamRes.error || statsRes.error || depthRes.error || injuriesRes.error || gamesRes.error || coachesRes.error
      if (err) {
        setError(err.message)
      } else {
        setTeam(teamRes.data)
        setStats(statsRes.data)
        setDepthChart(depthRes.data)
        setInjuries(injuriesRes.data)
        setGames(gamesRes.data)
        setCoaches(coachesRes.data)
      }
      setLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [teamAbbr, season])

  // Hover-card stats: fixed to STATS_SEASON regardless of the season toggle
  // above (see the constant's comment), so this is a separate fetch keyed
  // on the depth chart's own player list rather than on `season`.
  const depthChartPlayerIdsKey = [...new Set(depthChart.map((p) => p.player_id).filter(Boolean))].sort().join(',')

  useEffect(() => {
    const playerIds = depthChartPlayerIdsKey ? depthChartPlayerIdsKey.split(',') : []
    if (playerIds.length === 0) {
      setPopupData(null)
      return
    }
    let cancelled = false

    Promise.all([
      supabase.from('players').select('player_id, jersey_number').in('player_id', playerIds),
      supabase.from('player_season_offense_stats').select('*').in('player_id', playerIds).eq('season', STATS_SEASON),
      supabase.from('player_season_defense_stats').select('*').in('player_id', playerIds).eq('season', STATS_SEASON),
      supabase.from('player_season_special_teams_stats').select('*').in('player_id', playerIds).eq('season', STATS_SEASON),
      supabase.from('player_season_snap_counts').select('*').in('player_id', playerIds).eq('season', STATS_SEASON),
      supabase.from('player_season_share_stats').select('*').in('player_id', playerIds).eq('season', STATS_SEASON),
      supabase.from('team_game_stats').select('offense_snaps').eq('team', teamAbbr).eq('season', STATS_SEASON),
    ]).then(([playersRes, offenseRes, defenseRes, stRes, snapRes, shareRes, teamGamesRes]) => {
      if (cancelled) return
      if (playersRes.error || offenseRes.error || defenseRes.error || stRes.error || snapRes.error || shareRes.error || teamGamesRes.error) {
        return
      }
      const numberByPlayer = new Map(playersRes.data.map((r) => [r.player_id, r.jersey_number]))
      const offenseByPlayer = aggregateRowsByPlayer(offenseRes.data, ['games', 'passing_yards'])
      const defenseByPlayer = aggregateRowsByPlayer(defenseRes.data, [
        'def_sacks', 'def_qb_hits', 'def_tackles_for_loss', 'def_tackles_solo',
        'def_tackles_with_assist', 'def_pass_defended', 'def_interceptions',
      ])
      const stByPlayer = aggregateRowsByPlayer(stRes.data, ['fg_made', 'pt_yards', 'pt_att', 'kickoff_returns', 'punt_returns'])
      const snapByPlayer = aggregateRowsByPlayer(snapRes.data, ['offense_snaps', 'defense_snaps', 'st_snaps'])
      // Percentages, not counts -- summing across a mid-season trade's two
      // team rows wouldn't mean anything, so just keep one (last) row.
      const shareByPlayer = new Map(shareRes.data.map((r) => [r.player_id, r]))
      const teamPriorOffenseSnaps = teamGamesRes.data.reduce((acc, g) => acc + (g.offense_snaps ?? 0), 0)
      setPopupData({ numberByPlayer, offenseByPlayer, defenseByPlayer, stByPlayer, snapByPlayer, shareByPlayer, teamPriorOffenseSnaps })
    })

    return () => {
      cancelled = true
    }
  }, [teamAbbr, depthChartPlayerIdsKey])

  if (loading) return <LoadingSpinner full />
  if (error) return <p className="p-6 text-sm text-red-500">Error: {error}</p>
  if (!team) return <p className="p-6 text-sm text-neutral-500">Team not found.</p>

  const regGames = games.filter((g) => g.game_type === 'REG')
  const postGames = games
    .filter((g) => g.game_type !== 'REG')
    .sort((a, b) => a.week - b.week)
  const gamesByWeek = new Map(regGames.map((g) => [g.week, g]))

  // Starters: rank 1 within each recognized category, except skill
  // positions (RB/WR/TE) where several depth slots are all "starters".
  const rank1 = depthChart.filter((p) => p.rank === 1)
  const qbStarters = rank1.filter((p) => categoryOf(p) === 'qb')
  const olStarters = rank1
    .filter((p) => categoryOf(p) === 'ol')
    .sort((a, b) => OL_ORDER.indexOf(a.position_abbr) - OL_ORDER.indexOf(b.position_abbr))
  const skillStarters = depthChart
    .filter(isSkillStarter)
    .sort((a, b) => {
      const orderDiff = SKILL_ORDER.indexOf(a.position_abbr) - SKILL_ORDER.indexOf(b.position_abbr)
      return orderDiff !== 0 ? orderDiff : a.rank - b.rank
    })
  const dlStarters = sortByFieldOrder(rank1.filter((p) => categoryOf(p) === 'dl'), DL_ORDER)
  const lbStarters = sortByFieldOrder(rank1.filter((p) => categoryOf(p) === 'lb'), LB_ORDER)
  const cbStarters = sortByFieldOrder(rank1.filter((p) => categoryOf(p) === 'cb'), CB_ORDER)
  const sStarters = rank1.filter((p) => categoryOf(p) === 's')
  const kickingStarters = rank1.filter((p) => KICKING_STARTER_ABBRS.includes(p.position_abbr))
  const returnStarters = rank1.filter((p) => RETURN_STARTER_ABBRS.includes(p.position_abbr))

  const shownInStarters = new Set([
    ...qbStarters, ...olStarters, ...skillStarters,
    ...dlStarters, ...lbStarters, ...cbStarters, ...sStarters,
    ...kickingStarters, ...returnStarters,
  ])
  const injuryByPlayerId = new Map(injuries.map((i) => [i.player_id, i.report_status]))
  const depthRest = depthChart.filter((p) => !shownInStarters.has(p))
  const depthByGroup = depthRest.reduce((acc, row) => {
    ;(acc[row.position_group] ??= []).push(row)
    return acc
  }, {})

  // "Next up" for any player: the lowest-ranked player still below them at
  // that exact same position slot -- used both for the hover popup (every
  // player, healthy or not) and the bottom depth list's highlight (still
  // gated to injured/questionable starters only, see hoveredInjuredPlayer).
  function findNextUp(p) {
    if (!p) return null
    return (
      depthChart
        .filter((x) => x.position_name === p.position_name && x.position_slot === p.position_slot && x.rank > p.rank)
        .sort((a, b) => a.rank - b.rank)[0] ?? null
    )
  }
  const nextUpPlayer = findNextUp(hoveredInjuredPlayer)

  const colors = TEAM_COLORS[team.team_abbr]
  const record = stats && (
    <span className="text-xs font-normal normal-case text-neutral-400">
      {stats.wins}-{stats.losses}
      {stats.ties ? `-${stats.ties}` : ''} ({fmtDiff(stats.win_diff)})
    </span>
  )

  return (
    <div
      className="mx-auto w-full max-w-6xl px-4 py-6"
      style={
        colors
          ? {
              backgroundImage: `linear-gradient(to bottom, ${colors.primary}14, ${colors.secondary}0a, transparent 320px)`,
            }
          : undefined
      }
    >
      {/* Header: logo, name, conference/division */}
      <div className="mb-4 flex items-center gap-4">
        <img
          src={`${import.meta.env.BASE_URL}logos/${team.team_abbr}.png`}
          alt={team.team_abbr}
          className="h-20 w-20 object-contain"
        />
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
            {team.team_name}
          </h1>
          <p className="text-sm text-neutral-500">{team.division}</p>
        </div>
      </div>

      <div className="mb-8 flex gap-2">
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

      {/* Starters depth chart (left) + schedule/record/season stats (right) */}
      <div className="mb-8 flex flex-col gap-8 lg:flex-row">
        <div className="lg:w-[620px] lg:shrink-0">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">
            2026 Depth Chart
          </h2>

          <div className="mb-4">
            <h3 className="mb-1 text-xs font-bold uppercase text-neutral-400">Starting Offense</h3>
            <StarterRow label="QB" players={qbStarters} injuryByPlayerId={injuryByPlayerId}
              popupData={popupData} findNextUp={findNextUp}
              onHoverInjured={setHoveredInjuredPlayer}
              onUnhoverInjured={() => setHoveredInjuredPlayer(null)} />
            <StarterRow label="Offensive Line" players={olStarters} injuryByPlayerId={injuryByPlayerId}
              popupData={popupData} findNextUp={findNextUp}
              onHoverInjured={setHoveredInjuredPlayer}
              onUnhoverInjured={() => setHoveredInjuredPlayer(null)} />
            <StarterRow label="Skill" players={skillStarters} injuryByPlayerId={injuryByPlayerId}
              popupData={popupData} findNextUp={findNextUp}
              onHoverInjured={setHoveredInjuredPlayer}
              onUnhoverInjured={() => setHoveredInjuredPlayer(null)} />
          </div>

          <div className="mb-4">
            <h3 className="mb-1 text-xs font-bold uppercase text-neutral-400">Starting Defense</h3>
            <StarterRow label="D-Line" players={dlStarters} injuryByPlayerId={injuryByPlayerId}
              popupData={popupData} findNextUp={findNextUp}
              onHoverInjured={setHoveredInjuredPlayer}
              onUnhoverInjured={() => setHoveredInjuredPlayer(null)} />
            <StarterRow label="Linebackers" players={lbStarters} injuryByPlayerId={injuryByPlayerId}
              popupData={popupData} findNextUp={findNextUp}
              onHoverInjured={setHoveredInjuredPlayer}
              onUnhoverInjured={() => setHoveredInjuredPlayer(null)} />
            <StarterRow label="Corners" players={cbStarters} injuryByPlayerId={injuryByPlayerId}
              popupData={popupData} findNextUp={findNextUp}
              onHoverInjured={setHoveredInjuredPlayer}
              onUnhoverInjured={() => setHoveredInjuredPlayer(null)} />
            <StarterRow label="Safeties" players={sStarters} injuryByPlayerId={injuryByPlayerId}
              popupData={popupData} findNextUp={findNextUp}
              onHoverInjured={setHoveredInjuredPlayer}
              onUnhoverInjured={() => setHoveredInjuredPlayer(null)} />
          </div>

          <div className="mb-2">
            <h3 className="mb-1 text-xs font-bold uppercase text-neutral-400">Special Teams</h3>
            <StarterRow label="Kicking" players={kickingStarters} injuryByPlayerId={injuryByPlayerId}
              popupData={popupData} findNextUp={findNextUp}
              onHoverInjured={setHoveredInjuredPlayer}
              onUnhoverInjured={() => setHoveredInjuredPlayer(null)} />
            <StarterRow label="Return" players={returnStarters} injuryByPlayerId={injuryByPlayerId}
              popupData={popupData} findNextUp={findNextUp}
              onHoverInjured={setHoveredInjuredPlayer}
              onUnhoverInjured={() => setHoveredInjuredPlayer(null)} />
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <CoachingStaff coaches={coaches} />

          <h2 className="mb-2 flex items-baseline gap-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">
            Schedule
            {record}
          </h2>
          <div className="mb-2 grid grid-cols-9 gap-2">
            {WEEKS_PART1.map((week) => (
              <GameCell
                key={week}
                teamAbbr={teamAbbr}
                game={gamesByWeek.get(week)}
                byeLabel={`W${week}`}
              />
            ))}
          </div>
          <div className="grid grid-cols-9 gap-2">
            {WEEKS_PART2.map((week) => (
              <GameCell
                key={week}
                teamAbbr={teamAbbr}
                game={gamesByWeek.get(week)}
                byeLabel={`W${week}`}
              />
            ))}
          </div>

          {postGames.length > 0 && (
            <>
              <h2 className="mb-2 mt-4 text-sm font-semibold uppercase tracking-wide text-neutral-500">
                Postseason
              </h2>
              <div className="flex flex-wrap gap-2">
                {postGames.map((g) => (
                  <GameCell
                    key={g.game_id}
                    teamAbbr={teamAbbr}
                    game={g}
                    byeLabel={POSTSEASON_LABELS[g.game_type] ?? g.game_type}
                  />
                ))}
              </div>
            </>
          )}

          <h2 className="mb-2 mt-4 flex items-baseline gap-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">
            Season Stats
            {record}
          </h2>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-neutral-500 dark:border-neutral-800">
                <th className="py-2 font-medium">Stat</th>
                <th className="px-2 py-2 text-right font-medium">For</th>
                <th className="px-2 py-2 text-right font-medium">Against</th>
              </tr>
            </thead>
            <tbody>
              {stats ? (
                STAT_ROWS.map((row) => {
                  const [forVal, againstVal] = row.render(stats)
                  return (
                    <tr key={row.label} className="border-b border-neutral-100 dark:border-neutral-900">
                      <td className="py-1.5 text-neutral-700 dark:text-neutral-300">{row.label}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{forVal}</td>
                      <td className="px-2 py-1.5 text-right tabular-nums">{againstVal}</td>
                    </tr>
                  )
                })
              ) : (
                <tr>
                  <td colSpan={3} className="py-4 text-center text-neutral-400">
                    No stats yet for {season}.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <h3 className="mb-2 text-xs font-bold uppercase text-neutral-400">Depth</h3>
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {Object.entries(depthByGroup).map(([group, players]) => (
          <div key={group}>
            <h4 className="mb-1 text-xs font-semibold text-neutral-500">{group}</h4>
            <ul className="text-sm">
              {players.map((p) => (
                <DepthListItem
                  key={`${p.position_name}-${p.position_slot}-${p.rank}`}
                  p={p}
                  injuryStatus={injuryByPlayerId.get(p.player_id)}
                  isNextUp={p === nextUpPlayer}
                  popupData={popupData}
                  findNextUp={findNextUp}
                  onHoverInjured={setHoveredInjuredPlayer}
                  onUnhoverInjured={() => setHoveredInjuredPlayer(null)}
                />
              ))}
            </ul>
          </div>
        ))}
      </div>

      <InjuryLegend />
    </div>
  )
}
