import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from './supabaseClient'

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

// Per-game-average rows, shared by the "Heading In" and "Season Average"
// comparison tables -- same fields as team_game_stats, just averaged over
// however many games fall inside that window.
const AVG_STAT_ROWS = [
  ['Pass Yds/G', 'pass_yds'],
  ['Rush Yds/G', 'rush_yds'],
  ['Pass TD/G', 'pass_td'],
  ['Rush TD/G', 'rush_td'],
  ['INT Thrown/G', 'ints_thrown'],
  ['Fumbles Lost/G', 'fumbles_lost'],
  ['Sacks/G', 'sacks'],
  ['QB Hits/G', 'qb_hits'],
  ['Def INT/G', 'def_ints'],
  ['Punts/G', 'punts'],
  ['Punt Yds/G', 'punt_yards'],
  ['Kick Ret Yds/G', 'kick_return_yards'],
  ['Punt Ret Yds/G', 'punt_return_yards'],
]

// Same fields as AVG_STAT_ROWS but the raw single-game totals, for the
// "This Game" table -- kept as a separate list so labels drop the "/G".
const GAME_STAT_ROWS = [
  ['Pass Yds', 'pass_yds'],
  ['Rush Yds', 'rush_yds'],
  ['Pass TD', 'pass_td'],
  ['Rush TD', 'rush_td'],
  ['INT Thrown', 'ints_thrown'],
  ['Fumbles Lost', 'fumbles_lost'],
  ['Sacks', 'sacks'],
  ['QB Hits', 'qb_hits'],
  ['Def INT', 'def_ints'],
  ['Punts', 'punts'],
  ['Punt Yds', 'punt_yards'],
  ['Kick Ret Yds', 'kick_return_yards'],
  ['Punt Ret Yds', 'punt_return_yards'],
]

// Averages a set of team_game_stats rows (all belonging to one team) down
// to per-game numbers. Returns null when there are no games in the window
// so callers can show a "no games yet" state instead of a wall of zeros.
function avgStats(rows) {
  if (rows.length === 0) return null
  const n = rows.length
  const sum = (key) => rows.reduce((acc, r) => acc + (r[key] ?? 0), 0)
  const out = { games: n }
  for (const [, key] of AVG_STAT_ROWS) out[key] = sum(key) / n
  return out
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

// Shared by the pregame/season-average/this-game comparison tables --
// `rows` is either AVG_STAT_ROWS or GAME_STAT_ROWS, `fmt` picks fmtAvg vs
// fmtCount so per-game averages show a decimal and raw totals don't.
function StatComparisonTable({ title, subtitle, rows, fmt, awayData, homeData, awayAbbr, homeAbbr }) {
  return (
    <div className="mb-8">
      <h2 className="mb-0.5 text-sm font-semibold uppercase tracking-wide text-neutral-500">{title}</h2>
      {subtitle && <p className="mb-2 text-xs text-neutral-400">{subtitle}</p>}
      {!awayData || !homeData ? (
        <p className="text-sm text-neutral-400">No games in this window yet.</p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-neutral-500 dark:border-neutral-800">
              <th className="py-2 text-right font-medium">{awayAbbr}</th>
              <th className="py-2 pl-4 font-medium">Stat</th>
              <th className="py-2 pl-4 text-left font-medium">{homeAbbr}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, key]) => (
              <tr key={key} className="border-b border-neutral-100 dark:border-neutral-900">
                <td className="py-1.5 text-right tabular-nums">{fmt(awayData[key])}</td>
                <td className="py-1.5 pl-4 text-neutral-500">{label}</td>
                <td className="py-1.5 pl-4 tabular-nums">{fmt(homeData[key])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function BoxScoreSection({ title, columns, rows }) {
  if (rows.length === 0) return null
  return (
    <div className="mb-6">
      <h3 className="mb-2 text-xs font-bold uppercase text-neutral-400">{title}</h3>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-neutral-200 text-left text-neutral-500 dark:border-neutral-800">
            <th className="py-1.5 font-medium">Player</th>
            <th className="py-1.5 pl-2 font-medium">Team</th>
            {columns.map((c) => (
              <th key={c.key} className="py-1.5 pl-2 text-right font-medium">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.player_id} className="border-b border-neutral-100 dark:border-neutral-900">
              <td className="py-1.5 text-neutral-900 dark:text-neutral-100">
                {r.player_id ? (
                  <Link to={`/player/${r.player_id}`} className="hover:underline">
                    {r.players?.display_name ?? '—'}
                  </Link>
                ) : (
                  (r.players?.display_name ?? '—')
                )}
              </td>
              <td className="py-1.5 pl-2 text-neutral-500">{r.team}</td>
              {columns.map((c) => (
                <td key={c.key} className="py-1.5 pl-2 text-right tabular-nums">
                  {fmtCount(r[c.key])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function InjuryList({ abbr, rows }) {
  return (
    <div>
      <h3 className="mb-1 text-xs font-bold uppercase text-neutral-400">{abbr}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-neutral-400">No injury designations reported.</p>
      ) : (
        <ul className="text-sm">
          {rows.map((r) => (
            <li
              key={r.player_id}
              className="flex justify-between gap-2 border-b border-neutral-100 py-1 dark:border-neutral-900"
            >
              <span className="text-neutral-700 dark:text-neutral-300">
                {r.player_id ? (
                  <Link to={`/player/${r.player_id}`} className="hover:underline">
                    {r.full_name}
                  </Link>
                ) : (
                  r.full_name
                )}
                <span className="ml-1 text-xs text-neutral-400">{r.position}</span>
              </span>
              <span className={`shrink-0 text-xs font-medium ${INJURY_STATUS_STYLES[r.report_status] ?? 'text-neutral-400'}`}>
                {r.report_status ?? '—'}
                {r.report_primary_injury ? ` (${r.report_primary_injury})` : ''}
              </span>
            </li>
          ))}
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
  const [passing, setPassing] = useState([])
  const [rushing, setRushing] = useState([])
  const [receiving, setReceiving] = useState([])
  const [defense, setDefense] = useState([])
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
            .select('season, week, game_type, home_team, away_team, home_score, away_score')
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
            .select('*, players(display_name)')
            .eq('game_id', gameId)
            .gt('attempts', 0)
            .order('passing_yards', { ascending: false }),
          supabase
            .from('player_offense_stats')
            .select('*, players(display_name)')
            .eq('game_id', gameId)
            .gt('carries', 0)
            .order('rushing_yards', { ascending: false }),
          supabase
            .from('player_offense_stats')
            .select('*, players(display_name)')
            .eq('game_id', gameId)
            .gt('targets', 0)
            .order('receiving_yards', { ascending: false }),
          supabase
            .from('player_defense_stats')
            .select('*, players(display_name)')
            .eq('game_id', gameId)
            .order('def_tackles_solo', { ascending: false }),
        ]).then(([teamsRes, tgs, seasonGameRows, recGames, inj, pass, rush, rec, def]) => {
          if (cancelled) return
          const err =
            teamsRes.error || tgs.error || seasonGameRows.error || recGames.error || inj.error ||
            pass.error || rush.error || rec.error || def.error
          if (err) {
            setError(err.message)
          } else {
            setTeams(teamsRes.data)
            setTeamGameStats(tgs.data)
            setSeasonRows(seasonGameRows.data)
            setRecordGames(recGames.data)
            setInjuries(inj.data)
            setPassing(pass.data)
            setRushing(rush.data)
            setReceiving(rec.data)
            setDefense(def.data)
          }
          setLoading(false)
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

  const homePregameAvg = avgStats(homePregameRows)
  const awayPregameAvg = avgStats(awayPregameRows)
  const homeSeasonAvg = avgStats(homeSeasonRows)
  const awaySeasonAvg = avgStats(awaySeasonRows)

  const homeInjuries = injuries.filter((r) => r.team === game.home_team)
  const awayInjuries = injuries.filter((r) => r.team === game.away_team)

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6">
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

      <StatComparisonTable
        title="Heading In"
        subtitle={
          game.game_type === 'REG' && game.week > 1
            ? `Regular-season average, weeks 1–${game.week - 1}`
            : 'Regular-season average'
        }
        rows={AVG_STAT_ROWS}
        fmt={fmtAvg}
        awayData={awayPregameAvg}
        homeData={homePregameAvg}
        awayAbbr={game.away_team}
        homeAbbr={game.home_team}
      />

      <StatComparisonTable
        title="Season Average"
        subtitle="Regular-season average, all games played this season"
        rows={AVG_STAT_ROWS}
        fmt={fmtAvg}
        awayData={awaySeasonAvg}
        homeData={homeSeasonAvg}
        awayAbbr={game.away_team}
        homeAbbr={game.home_team}
      />

      <StatComparisonTable
        title="This Game"
        rows={GAME_STAT_ROWS}
        fmt={fmtCount}
        awayData={awayGameStats}
        homeData={homeGameStats}
        awayAbbr={game.away_team}
        homeAbbr={game.home_team}
      />

      <div className="mb-8">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">
          Injury Report
        </h2>
        <p className="mb-3 text-xs text-neutral-400">
          As reported for {game.season} {weekLabel(game)}.
        </p>
        <div className="grid gap-6 sm:grid-cols-2">
          <InjuryList abbr={game.away_team} rows={awayInjuries} />
          <InjuryList abbr={game.home_team} rows={homeInjuries} />
        </div>
      </div>

      {!played ? (
        <p className="text-sm text-neutral-400">Box score will be available after kickoff.</p>
      ) : (
        <>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">Box Score</h2>
          <BoxScoreSection
            title="Passing"
            rows={passing}
            columns={[
              { key: 'completions', label: 'C' },
              { key: 'attempts', label: 'ATT' },
              { key: 'passing_yards', label: 'YDS' },
              { key: 'passing_tds', label: 'TD' },
              { key: 'passing_interceptions', label: 'INT' },
            ]}
          />
          <BoxScoreSection
            title="Rushing"
            rows={rushing}
            columns={[
              { key: 'carries', label: 'CAR' },
              { key: 'rushing_yards', label: 'YDS' },
              { key: 'rushing_tds', label: 'TD' },
            ]}
          />
          <BoxScoreSection
            title="Receiving"
            rows={receiving}
            columns={[
              { key: 'receptions', label: 'REC' },
              { key: 'targets', label: 'TGT' },
              { key: 'receiving_yards', label: 'YDS' },
              { key: 'receiving_tds', label: 'TD' },
            ]}
          />
          <BoxScoreSection
            title="Defense"
            rows={defense}
            columns={[
              { key: 'def_tackles_solo', label: 'SOLO' },
              { key: 'def_tackles_with_assist', label: 'AST' },
              { key: 'def_sacks', label: 'SACK' },
              { key: 'def_interceptions', label: 'INT' },
              { key: 'def_pass_defended', label: 'PD' },
            ]}
          />
        </>
      )}
    </div>
  )
}
