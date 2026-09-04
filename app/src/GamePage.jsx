import { Fragment, useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from './supabaseClient'
import { TEAM_COLORS, hexToRgba, contrastTextColor } from './teamColors'

const POSTSEASON_LABELS = { WC: 'Wild Card', DIV: 'Divisional', CON: 'Conference Championship', SB: 'Super Bowl' }

const INJURY_STATUS_STYLES = {
  Out: 'text-red-600 dark:text-red-400',
  Doubtful: 'text-orange-600 dark:text-orange-400',
  Questionable: 'text-yellow-600 dark:text-yellow-500',
}

function fmtDiff(n) {
  if (n == null) return '—'
  return n > 0 ? `+${n}` : `${n}`
}

function fmtAvg(n) {
  return n == null ? '—' : n.toFixed(1)
}

function fmtCount(n) {
  return n ?? 0
}

// Box-score cells specifically: a bare 0 just adds visual noise across a
// wide stat grid, so blank it out like a missing value would be.
function fmtStat(n) {
  return n == null || n === 0 ? '—' : n
}

function fmtPct(n) {
  return n == null ? '—' : `${n}%`
}

// Drops just the first token (first name), keeping the rest -- handles
// suffixes like "Jr."/"III" better than taking only the last token would.
function lastNameOnly(fullName) {
  if (!fullName) return '—'
  const rest = fullName.split(' ').slice(1).join(' ')
  return rest || fullName
}

function fmtKickoff(gameday, weekday, gametime) {
  if (!gameday) return weekday || 'Date TBD'
  const dateStr = new Date(`${gameday}T00:00:00`).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  })
  if (!gametime) return dateStr
  const [h, m] = gametime.split(':').map(Number)
  const timeStr = Number.isNaN(h)
    ? null
    : new Date(2000, 0, 1, h, m).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return timeStr ? `${dateStr} · ${timeStr}` : dateStr
}

function weekLabel(game) {
  return game.game_type === 'REG' ? `Week ${game.week}` : POSTSEASON_LABELS[game.game_type] ?? game.game_type
}

// Same row set (labels + combined-value formatting) as the team-page's own
// season stats table, so this page reads as the same "language" -- just
// against a single team's own numbers per window instead of a for/against
// split.
const STAT_ROWS = [
  { label: 'Rush Yds Avg', render: (s) => fmtAvg(s.rush_yds_avg) },
  { label: 'Pass Yds Avg', render: (s) => fmtAvg(s.pass_yds_avg) },
  { label: 'Turnovers [I/F]', render: (s) => `${fmtCount(s.turnovers_int)}/${fmtCount(s.turnovers_fumble)}` },
  { label: 'Pass/Rush TD', render: (s) => `${fmtCount(s.pass_td)}/${fmtCount(s.rush_td)}` },
  { label: 'Sacks/QB Hits', render: (s) => `${fmtCount(s.sacks)}/${fmtCount(s.qb_hits)}` },
  { label: 'Punts Avg', render: (s) => fmtAvg(s.punts_avg) },
  { label: 'Punt Return %', render: (s) => fmtPct(s.punt_return_pct_for) },
  { label: 'Kick Return Yds Avg', render: (s) => fmtAvg(s.kick_return_yards_avg) },
  { label: 'Punt Return Yds Avg', render: (s) => fmtAvg(s.punt_return_yards_avg) },
  { label: 'Offensive Snaps Avg', render: (s) => fmtAvg(s.offense_snaps_avg) },
  { label: 'Defensive Snaps Avg', render: (s) => fmtAvg(s.defense_snaps_avg) },
]

// Collapses a set of team_game_stats rows (all belonging to one team) into
// the same field shape team_season_stats uses (*_avg fields, summed counts,
// punt_return_pct_for) -- one game's worth of rows works too, so the same
// function and the same STAT_ROWS render feed the Pre-game, Season, and
// Game columns alike. Returns null for an empty window (no games yet).
function buildStatRow(rows) {
  if (rows.length === 0) return null
  const n = rows.length
  const sum = (key) => rows.reduce((acc, r) => acc + (r[key] ?? 0), 0)
  const puntsSum = sum('punts')
  return {
    rush_yds_avg: sum('rush_yds') / n,
    pass_yds_avg: sum('pass_yds') / n,
    turnovers_int: sum('ints_thrown'),
    turnovers_fumble: sum('fumbles_lost'),
    pass_td: sum('pass_td'),
    rush_td: sum('rush_td'),
    sacks: sum('sacks'),
    qb_hits: sum('qb_hits'),
    punts_avg: puntsSum / n,
    punt_return_pct_for: puntsSum ? Math.round((1000 * sum('pt_returned')) / puntsSum) / 10 : null,
    kick_return_yards_avg: sum('kick_return_yards') / n,
    punt_return_yards_avg: sum('punt_return_yards') / n,
    offense_snaps_avg: sum('offense_snaps') / n,
    defense_snaps_avg: sum('defense_snaps') / n,
  }
}

// Box-score column sets. Each column renders straight off the row rather
// than a plain key lookup so combined fields (e.g. fumble recoveries, which
// come from separate _own/_opp columns) work the same way simple ones do.
const c = (label, key) => ({ label, render: (r) => fmtStat(r[key]) })
const PASSING_COLUMNS = [
  c('C', 'completions'),
  c('ATT', 'attempts'),
  c('YDS', 'passing_yards'),
  c('TD', 'passing_tds'),
  c('INT', 'passing_interceptions'),
]
const RUSHING_COLUMNS = [c('CAR', 'carries'), c('YDS', 'rushing_yards'), c('TD', 'rushing_tds')]
const RECEIVING_COLUMNS = [
  c('REC', 'receptions'),
  c('TGT', 'targets'),
  c('YDS', 'receiving_yards'),
  c('TD', 'receiving_tds'),
]
const DEFENSE_COLUMNS = [
  c('SOLO', 'def_tackles_solo'),
  c('AST', 'def_tackles_with_assist'),
  c('TFL', 'def_tackles_for_loss'),
  c('SACK', 'def_sacks'),
  c('QB HITS', 'def_qb_hits'),
  c('PD', 'def_pass_defended'),
]
// Interceptions + forced fumbles + fumble recoveries in one takeaways table
// (all three are "defense created a turnover", just different mechanisms).
const TAKEAWAYS_COLUMNS = [
  c('INT', 'def_interceptions'),
  c('INT YDS', 'def_interception_yards'),
  c('FF', 'def_fumbles_forced'),
  { label: 'FR', render: (r) => fmtStat((r.fumble_recovery_own ?? 0) + (r.fumble_recovery_opp ?? 0)) },
  {
    label: 'FR YDS',
    render: (r) => fmtStat((r.fumble_recovery_yards_own ?? 0) + (r.fumble_recovery_yards_opp ?? 0)),
  },
]
const KICKING_COLUMNS = [
  { label: 'FG', render: (r) => (r.fg_att ? `${fmtCount(r.fg_made)}/${r.fg_att}` : '—') },
  c('LNG', 'fg_long'),
  { label: 'PAT', render: (r) => (r.pat_att ? `${fmtCount(r.pat_made)}/${r.pat_att}` : '—') },
]
const PUNTING_COLUMNS = [
  c('PUNTS', 'pt_att'),
  c('YDS', 'pt_yards'),
  { label: 'AVG', render: (r) => (r.pt_att ? fmtAvg(r.pt_yards / r.pt_att) : '—') },
  c('LNG', 'pt_long'),
  c('IN20', 'pt_inside_20'),
]
const RETURN_COLUMNS = [
  c('KR', 'kickoff_returns'),
  c('KR YDS', 'kickoff_return_yards'),
  c('PR', 'punt_returns'),
  c('PR YDS', 'punt_return_yards'),
  c('TD', 'special_teams_tds'),
]

// Away team's colors on the left, home team's on the right, primary at the
// top fading to secondary at the bottom on each side, with a gray band
// where the two sides meet in the middle. Built as three stacked
// background-image layers (a full-width gray fade over two half-width
// vertical team gradients) since a single CSS gradient can't vary in both
// directions at once.
function pageGradientStyle(awayAbbr, homeAbbr) {
  const away = TEAM_COLORS[awayAbbr]
  const home = TEAM_COLORS[homeAbbr]
  if (!away || !home) return {}
  const alpha = 0.07
  return {
    // The away/home team washes are each their own 50%-wide layer, so they
    // butt up against each other at a hard edge right at the center -- at
    // 0.4 alpha the gray band was translucent enough that each side's own
    // (different) team color still showed through it, leaving a visible
    // seam exactly where the two layers meet. Near-opaque (0.92) fully
    // covers that edge across a wide enough band that both sides render as
    // the identical gray, not just a similar one.
    backgroundImage: [
      'linear-gradient(to right, transparent 0%, transparent 20%, rgba(115,115,115,0.92) 42%, rgba(115,115,115,0.92) 58%, transparent 80%, transparent 100%)',
      `linear-gradient(to bottom, ${hexToRgba(away.primary, alpha)}, ${hexToRgba(away.secondary, alpha)})`,
      `linear-gradient(to bottom, ${hexToRgba(home.primary, alpha)}, ${hexToRgba(home.secondary, alpha)})`,
    ].join(', '),
    backgroundSize: '100% 100%, 50% 100%, 50% 100%',
    backgroundPosition: '0 0, left top, right top',
    backgroundRepeat: 'no-repeat',
  }
}

function recordFor(games, team) {
  let wins = 0
  let losses = 0
  let ties = 0
  for (const g of games) {
    const isHome = g.home_team === team
    const isAway = g.away_team === team
    if (!isHome && !isAway) continue
    const teamScore = isHome ? g.home_score : g.away_score
    const oppScore = isHome ? g.away_score : g.home_score
    if (teamScore > oppScore) wins++
    else if (teamScore < oppScore) losses++
    else ties++
  }
  return { wins, losses, ties }
}

function TeamHeader({ abbr, name, score, isWinner, played, align }) {
  return (
    <Link
      to={`/team/${abbr}`}
      className={`flex flex-1 items-center gap-4 hover:opacity-80 ${
        align === 'right' ? 'flex-row-reverse text-right' : 'text-left'
      }`}
    >
      <img
        src={`${import.meta.env.BASE_URL}logos/${abbr}.png`}
        alt={abbr}
        className="h-16 w-16 shrink-0 object-contain"
      />
      <div>
        <div
          className={`text-lg font-semibold ${
            isWinner ? 'text-neutral-900 dark:text-neutral-100' : 'text-neutral-500 dark:text-neutral-400'
          }`}
        >
          {name ?? abbr}
        </div>
        {played && (
          <div
            className={`text-3xl font-bold tabular-nums ${
              isWinner ? 'text-neutral-900 dark:text-neutral-100' : 'text-neutral-400 dark:text-neutral-600'
            }`}
          >
            {score}
          </div>
        )}
      </div>
    </Link>
  )
}

// One table, three time windows (Pre-game / Season / Game) each split into
// an away/home sub-column -- matches the grouped-column convention already
// used by the league table (TeamStatsTable's For/Against columns).
// Team-colored pill for a column header -- background is the team's own
// primary color, text picked for contrast against it rather than assumed.
function TeamAbbrChip({ abbr }) {
  const colors = TEAM_COLORS[abbr]
  if (!colors) return <span>{abbr}</span>
  return (
    <span
      className="inline-block rounded px-1.5 py-0.5 font-semibold"
      style={{ backgroundColor: colors.primary, color: contrastTextColor(colors.primary) }}
    >
      {abbr}
    </span>
  )
}

function MatchupStatsTable({ windows, awayAbbr, homeAbbr }) {
  return (
    <div className="mb-8 overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-neutral-200 text-left text-neutral-500 dark:border-neutral-800">
            <th className="py-2 font-medium">Stat</th>
            {windows.map((w) => (
              <th key={w.label} colSpan={2} className="px-2 py-2 text-center font-medium">
                {w.label}
              </th>
            ))}
          </tr>
          <tr className="border-b border-neutral-200 text-left text-[11px] text-neutral-400 dark:border-neutral-800">
            <th></th>
            {windows.map((w) => (
              <Fragment key={w.label}>
                <th className="px-2 pb-1 text-right font-normal">
                  <TeamAbbrChip abbr={awayAbbr} />
                </th>
                <th className="px-2 pb-1 text-right font-normal">
                  <TeamAbbrChip abbr={homeAbbr} />
                </th>
              </Fragment>
            ))}
          </tr>
        </thead>
        <tbody>
          {STAT_ROWS.map((row) => (
            <tr key={row.label} className="border-b border-neutral-100 dark:border-neutral-900">
              <td className="py-1.5 text-neutral-500">{row.label}</td>
              {windows.map((w) => (
                <Fragment key={w.label}>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {w.away ? row.render(w.away) : '—'}
                  </td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {w.home ? row.render(w.home) : '—'}
                  </td>
                </Fragment>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// One team's half of a box-score category -- player name links to their
// player-card page, position comes from the joined players row.
function BoxScoreTeamTable({ abbr, rows, columns }) {
  return (
    <div>
      <h4 className="mb-1 text-xs font-semibold text-neutral-500">{abbr}</h4>
      {rows.length === 0 ? (
        <p className="text-sm text-neutral-400">No stats.</p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-neutral-500 dark:border-neutral-800">
              <th className="py-1.5 font-medium">Player</th>
              <th className="py-1.5 pl-2 font-medium">Pos</th>
              {columns.map((c) => (
                <th key={c.label} className="py-1.5 pl-2 text-right font-medium">
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.player_id} className="border-b border-neutral-100 dark:border-neutral-900">
                <td className="py-1.5">
                  <Link to={`/player/${r.player_id}`} className="text-neutral-900 hover:underline dark:text-neutral-100">
                    {lastNameOnly(r.players?.display_name)}
                  </Link>
                </td>
                <td className="py-1.5 pl-2 text-neutral-400">{r.players?.position ?? '—'}</td>
                {columns.map((c) => (
                  <td key={c.label} className="py-1.5 pl-2 text-right tabular-nums">
                    {c.render(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

// A box-score category is two team tables side by side (away, then home).
function BoxScoreSection({ title, columns, awayRows, homeRows, awayAbbr, homeAbbr }) {
  if (awayRows.length === 0 && homeRows.length === 0) return null
  return (
    <div className="mb-6">
      <h3 className="mb-2 text-xs font-bold uppercase text-neutral-400">{title}</h3>
      <div className="grid gap-6 overflow-x-auto sm:grid-cols-2 sm:gap-x-12">
        <BoxScoreTeamTable abbr={awayAbbr} rows={awayRows} columns={columns} />
        <BoxScoreTeamTable abbr={homeAbbr} rows={homeRows} columns={columns} />
      </div>
    </div>
  )
}

function InjuryList({ abbr, rows, depthRankByPlayerId, snapsByPlayerId }) {
  return (
    <div>
      <h3 className="mb-1 text-xs font-bold uppercase text-neutral-400">{abbr}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-neutral-400">No injury designations reported.</p>
      ) : (
        <ul className="text-sm">
          {rows.map((r) => {
            const depthRank = depthRankByPlayerId.get(r.player_id)
            const snaps = snapsByPlayerId.get(r.player_id)
            return (
              <li key={r.player_id} className="border-b border-neutral-100 py-1.5 dark:border-neutral-900">
                <div className="flex justify-between gap-2">
                  <span className="text-neutral-700 dark:text-neutral-300">
                    {r.full_name}
                    <span className="ml-1 text-xs text-neutral-400">{r.position}</span>
                  </span>
                  <span className={`shrink-0 text-xs font-medium ${INJURY_STATUS_STYLES[r.report_status] ?? 'text-neutral-400'}`}>
                    {r.report_status ?? '—'}
                    {r.report_primary_injury ? ` (${r.report_primary_injury})` : ''}
                  </span>
                </div>
                <div className="text-[11px] text-neutral-400">
                  {depthRank ?? 'Not on depth chart'}
                  {' · '}
                  {snaps ? `${snaps.total} snaps (${snaps.games} gm) this season` : 'No snaps yet this season'}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export default function GamePage() {
  const { gameId } = useParams()
  const [game, setGame] = useState(null)
  const [teams, setTeams] = useState([])
  const [teamGameStats, setTeamGameStats] = useState([])
  const [seasonRows, setSeasonRows] = useState([])
  const [recordGames, setRecordGames] = useState([])
  const [injuries, setInjuries] = useState([])
  const [injuryDepthRanks, setInjuryDepthRanks] = useState([])
  const [injurySnapCounts, setInjurySnapCounts] = useState([])
  const [offense, setOffense] = useState([])
  const [defense, setDefense] = useState([])
  const [specialTeams, setSpecialTeams] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    supabase
      .from('games')
      .select('*')
      .eq('game_id', gameId)
      .single()
      .then(({ data: gameData, error: gameErr }) => {
        if (cancelled) return
        if (gameErr || !gameData) {
          setError(gameErr?.message ?? 'Game not found.')
          setLoading(false)
          return
        }
        setGame(gameData)
        const teamAbbrs = [gameData.home_team, gameData.away_team]

        Promise.all([
          supabase.from('teams').select('team_abbr, team_name').in('team_abbr', teamAbbrs),
          supabase.from('team_game_stats').select('*').eq('game_id', gameId),
          // Every REG-season game these two teams have played this season --
          // sliced client-side into "before this week" vs "all of it" so the
          // Heading In / Season Average tables share one query and one shape.
          supabase
            .from('team_game_stats')
            .select('*')
            .eq('season', gameData.season)
            .eq('game_type', 'REG')
            .in('team', teamAbbrs),
          // Every scored REG game either team has played this season, used to
          // compute each team's record as of kickoff (not the final record).
          supabase
            .from('games')
            .select('game_id, season, week, game_type, home_team, away_team, home_score, away_score')
            .eq('season', gameData.season)
            .eq('game_type', 'REG')
            .or(teamAbbrs.map((t) => `home_team.eq.${t},away_team.eq.${t}`).join(','))
            .not('home_score', 'is', null),
          supabase
            .from('injuries')
            .select('*')
            .eq('season', gameData.season)
            .eq('week', gameData.week)
            .eq('game_type', gameData.game_type)
            .in('team', teamAbbrs),
          supabase
            .from('player_offense_stats')
            .select('*, players(display_name, position)')
            .eq('game_id', gameId),
          supabase
            .from('player_defense_stats')
            .select('*, players(display_name, position)')
            .eq('game_id', gameId)
            .order('def_tackles_solo', { ascending: false }),
          supabase
            .from('player_special_teams_stats')
            .select('*, players(display_name, position)')
            .eq('game_id', gameId),
        ]).then(([teamsRes, tgs, seasonGameRows, recGames, inj, off, def, st]) => {
          if (cancelled) return
          const err =
            teamsRes.error || tgs.error || seasonGameRows.error || recGames.error || inj.error ||
            off.error || def.error || st.error
          if (err) {
            setError(err.message)
          } else {
            setTeams(teamsRes.data)
            setTeamGameStats(tgs.data)
            setSeasonRows(seasonGameRows.data)
            setRecordGames(recGames.data)
            setInjuries(inj.data)
            setOffense(off.data)
            setDefense(def.data)
            setSpecialTeams(st.data)
          }
          setLoading(false)

          // Depth chart rank and season-to-date snaps for whoever's on the
          // injury report -- a second round-trip since both depend on the
          // player_id list the injuries query above just resolved.
          const injuryPlayerIds = [...new Set(inj.data.map((r) => r.player_id))]
          if (injuryPlayerIds.length === 0) return
          Promise.all([
            supabase.from('depth_chart_ranks').select('player_id, position_abbr, rank').in('player_id', injuryPlayerIds),
            supabase
              .from('player_snap_counts')
              .select('player_id, game_id, offense_snaps, defense_snaps, st_snaps')
              .in('player_id', injuryPlayerIds),
          ]).then(([dcRes, snapRes]) => {
            if (cancelled) return
            if (!dcRes.error) setInjuryDepthRanks(dcRes.data)
            if (!snapRes.error) setInjurySnapCounts(snapRes.data)
          })
        })
      })

    return () => {
      cancelled = true
    }
  }, [gameId])

  if (loading) return <p className="p-6 text-sm text-neutral-500">Loading…</p>
  if (error) return <p className="p-6 text-sm text-red-500">Error: {error}</p>
  if (!game) return <p className="p-6 text-sm text-neutral-500">Game not found.</p>

  const teamsByAbbr = new Map(teams.map((t) => [t.team_abbr, t]))
  const played = game.home_score != null && game.away_score != null
  const homeWinner = played && game.home_score > game.away_score
  const awayWinner = played && game.away_score > game.home_score
  const homeGameStats = teamGameStats.find((s) => s.team === game.home_team)
  const awayGameStats = teamGameStats.find((s) => s.team === game.away_team)

  // Record as of kickoff -- only games strictly before this week count, so
  // this matches the "Heading In" stat window rather than the final record.
  const pregameGames =
    game.game_type === 'REG' ? recordGames.filter((g) => g.week < game.week) : recordGames
  const homeRecord = recordFor(pregameGames, game.home_team)
  const awayRecord = recordFor(pregameGames, game.away_team)

  const homeSeasonRows = seasonRows.filter((r) => r.team === game.home_team)
  const awaySeasonRows = seasonRows.filter((r) => r.team === game.away_team)
  const homePregameRows =
    game.game_type === 'REG' ? homeSeasonRows.filter((r) => r.week < game.week) : homeSeasonRows
  const awayPregameRows =
    game.game_type === 'REG' ? awaySeasonRows.filter((r) => r.week < game.week) : awaySeasonRows

  const homePregameStats = buildStatRow(homePregameRows)
  const awayPregameStats = buildStatRow(awayPregameRows)
  const homeSeasonStats = buildStatRow(homeSeasonRows)
  const awaySeasonStats = buildStatRow(awaySeasonRows)
  const homeGameStatRow = buildStatRow(homeGameStats ? [homeGameStats] : [])
  const awayGameStatRow = buildStatRow(awayGameStats ? [awayGameStats] : [])

  const homeInjuries = injuries.filter((r) => r.team === game.home_team)
  const awayInjuries = injuries.filter((r) => r.team === game.away_team)

  // Depth chart rank (current snapshot -- see depth_chart_ranks' own
  // comment, there's no historical version) and season-to-date snap
  // totals as of kickoff, keyed by player_id for the injury report below.
  const depthRankByPlayerId = new Map(
    injuryDepthRanks.map((r) => [r.player_id, `${r.position_abbr}${r.rank > 1 ? r.rank : ''}`]),
  )
  const pregameGameIds = new Set(pregameGames.map((g) => g.game_id))
  const snapsByPlayerId = new Map()
  for (const row of injurySnapCounts) {
    if (!pregameGameIds.has(row.game_id)) continue
    const cur = snapsByPlayerId.get(row.player_id) ?? { total: 0, games: 0 }
    cur.total += (row.offense_snaps ?? 0) + (row.defense_snaps ?? 0) + (row.st_snaps ?? 0)
    cur.games += 1
    snapsByPlayerId.set(row.player_id, cur)
  }

  // Box score: split each category into an away/home pair, sorted and
  // filtered to players who actually recorded that category's stat.
  const byTeam = (rows, filter) => {
    const filtered = filter ? rows.filter(filter) : rows
    return {
      away: filtered.filter((r) => r.team === game.away_team),
      home: filtered.filter((r) => r.team === game.home_team),
    }
  }
  const passing = byTeam(
    [...offense].sort((a, b) => (b.passing_yards ?? 0) - (a.passing_yards ?? 0)),
    (r) => (r.attempts ?? 0) > 0,
  )
  const rushing = byTeam(
    [...offense].sort((a, b) => (b.rushing_yards ?? 0) - (a.rushing_yards ?? 0)),
    (r) => (r.carries ?? 0) > 0,
  )
  const receiving = byTeam(
    [...offense].sort((a, b) => (b.receiving_yards ?? 0) - (a.receiving_yards ?? 0)),
    (r) => (r.targets ?? 0) > 0,
  )
  const tackling = byTeam(
    defense,
    (r) => (r.def_tackles_solo ?? 0) > 0 || (r.def_tackles_with_assist ?? 0) > 0 ||
      (r.def_sacks ?? 0) > 0 || (r.def_tackles_for_loss ?? 0) > 0 || (r.def_qb_hits ?? 0) > 0,
  )
  const takeaways = byTeam(
    defense,
    (r) =>
      (r.def_interceptions ?? 0) > 0 ||
      (r.def_fumbles_forced ?? 0) > 0 ||
      (r.fumble_recovery_own ?? 0) + (r.fumble_recovery_opp ?? 0) > 0,
  )
  const kicking = byTeam(specialTeams, (r) => (r.fg_att ?? 0) > 0 || (r.pat_att ?? 0) > 0)
  const punting = byTeam(specialTeams, (r) => (r.pt_att ?? 0) > 0)
  const returns = byTeam(specialTeams, (r) => (r.kickoff_returns ?? 0) > 0 || (r.punt_returns ?? 0) > 0)

  return (
    <div className="relative">
      <div
        className="pointer-events-none absolute inset-0"
        style={pageGradientStyle(game.away_team, game.home_team)}
      />
      <div className="relative mx-auto w-full max-w-4xl px-4 py-6">
      <Link to="/matches" className="mb-4 inline-block text-xs text-neutral-500 hover:underline">
        ← Back to Matches
      </Link>

      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-400">
        {game.season} {weekLabel(game)}
      </div>
      <div className="mb-6 text-sm text-neutral-500">{fmtKickoff(game.gameday, game.weekday, game.gametime)}</div>

      <div className="mb-8 flex items-center justify-between gap-4">
        <TeamHeader
          abbr={game.away_team}
          name={teamsByAbbr.get(game.away_team)?.team_name}
          score={game.away_score}
          isWinner={awayWinner || !played}
          played={played}
          align="left"
        />
        <span className="shrink-0 text-sm text-neutral-400">@</span>
        <TeamHeader
          abbr={game.home_team}
          name={teamsByAbbr.get(game.home_team)?.team_name}
          score={game.home_score}
          isWinner={homeWinner || !played}
          played={played}
          align="right"
        />
      </div>

      {/* Pregame context: record entering kickoff + line, always useful whether or not the game has been played */}
      <div className="mb-8 grid grid-cols-2 gap-4 rounded border border-neutral-200 p-4 text-sm sm:grid-cols-4 dark:border-neutral-800">
        <div>
          <div className="text-xs text-neutral-400">{game.away_team} Record</div>
          <div className="font-medium text-neutral-900 dark:text-neutral-100">
            {awayRecord.wins}-{awayRecord.losses}
            {awayRecord.ties ? `-${awayRecord.ties}` : ''}
          </div>
        </div>
        <div>
          <div className="text-xs text-neutral-400">{game.home_team} Record</div>
          <div className="font-medium text-neutral-900 dark:text-neutral-100">
            {homeRecord.wins}-{homeRecord.losses}
            {homeRecord.ties ? `-${homeRecord.ties}` : ''}
          </div>
        </div>
        <div>
          <div className="text-xs text-neutral-400">Spread</div>
          <div className="font-medium text-neutral-900 dark:text-neutral-100">
            {game.spread_line != null ? fmtDiff(game.spread_line) : '—'}
          </div>
        </div>
        <div>
          <div className="text-xs text-neutral-400">Total</div>
          <div className="font-medium text-neutral-900 dark:text-neutral-100">{game.total_line ?? '—'}</div>
        </div>
        {(game.stadium || game.roof || game.surface || game.temp != null || game.wind != null) && (
          <div className="col-span-2 sm:col-span-4">
            <div className="text-xs text-neutral-400">Venue</div>
            <div className="text-neutral-700 dark:text-neutral-300">
              {[
                game.stadium,
                game.roof,
                game.surface,
                game.temp != null ? `${game.temp}°F` : null,
                game.wind != null ? `${game.wind} mph wind` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
            </div>
          </div>
        )}
      </div>

      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">Team Stats</h2>
      <MatchupStatsTable
        awayAbbr={game.away_team}
        homeAbbr={game.home_team}
        windows={[
          { label: 'Pre-game', away: awayPregameStats, home: homePregameStats },
          { label: 'Season', away: awaySeasonStats, home: homeSeasonStats },
          { label: 'Game', away: awayGameStatRow, home: homeGameStatRow },
        ]}
      />

      <div className="mb-8">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Injury Report
        </h2>
        <p className="mb-3 text-xs text-neutral-400">
          As reported for {game.season} {weekLabel(game)}.
        </p>
        <div className="grid gap-6 sm:grid-cols-2">
          <InjuryList
            abbr={game.away_team}
            rows={awayInjuries}
            depthRankByPlayerId={depthRankByPlayerId}
            snapsByPlayerId={snapsByPlayerId}
          />
          <InjuryList
            abbr={game.home_team}
            rows={homeInjuries}
            depthRankByPlayerId={depthRankByPlayerId}
            snapsByPlayerId={snapsByPlayerId}
          />
        </div>
      </div>

      {!played ? (
        <p className="text-sm text-neutral-400">Box score will be available after kickoff.</p>
      ) : (
        <>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">Box Score</h2>
          <BoxScoreSection title="Passing" columns={PASSING_COLUMNS} awayRows={passing.away} homeRows={passing.home} awayAbbr={game.away_team} homeAbbr={game.home_team} />
          <BoxScoreSection title="Rushing" columns={RUSHING_COLUMNS} awayRows={rushing.away} homeRows={rushing.home} awayAbbr={game.away_team} homeAbbr={game.home_team} />
          <BoxScoreSection title="Receiving" columns={RECEIVING_COLUMNS} awayRows={receiving.away} homeRows={receiving.home} awayAbbr={game.away_team} homeAbbr={game.home_team} />
          <BoxScoreSection title="Defense" columns={DEFENSE_COLUMNS} awayRows={tackling.away} homeRows={tackling.home} awayAbbr={game.away_team} homeAbbr={game.home_team} />
          <BoxScoreSection title="Takeaways" columns={TAKEAWAYS_COLUMNS} awayRows={takeaways.away} homeRows={takeaways.home} awayAbbr={game.away_team} homeAbbr={game.home_team} />
          <BoxScoreSection title="Kicking" columns={KICKING_COLUMNS} awayRows={kicking.away} homeRows={kicking.home} awayAbbr={game.away_team} homeAbbr={game.home_team} />
          <BoxScoreSection title="Punting" columns={PUNTING_COLUMNS} awayRows={punting.away} homeRows={punting.home} awayAbbr={game.away_team} homeAbbr={game.home_team} />
          <BoxScoreSection title="Return" columns={RETURN_COLUMNS} awayRows={returns.away} homeRows={returns.home} awayAbbr={game.away_team} homeAbbr={game.home_team} />
        </>
      )}
      </div>
    </div>
  )
}
