import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from './supabaseClient'
import { CURRENT_TEAMS } from './constants'

function fmtHeight(inches) {
  if (inches == null) return '—'
  const feet = Math.floor(inches / 12)
  const rem = inches % 12
  return `${feet}'${rem}"`
}

function fmtWeight(lbs) {
  return lbs == null ? '—' : `${lbs} lbs`
}

function fmtBirthDate(dateStr) {
  if (!dateStr) return null
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

function ageFromBirthDate(dateStr) {
  if (!dateStr) return null
  const birth = new Date(`${dateStr}T00:00:00`)
  const now = new Date()
  let age = now.getFullYear() - birth.getFullYear()
  const hasHadBirthdayThisYear =
    now.getMonth() > birth.getMonth() ||
    (now.getMonth() === birth.getMonth() && now.getDate() >= birth.getDate())
  if (!hasHadBirthdayThisYear) age -= 1
  return age
}

function initials(name) {
  if (!name) return '?'
  return name
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

// Sums a list of numeric fields across rows, treating null/undefined as
// absent (not zero) so a field with no data anywhere renders as "—" rather
// than "0".
function sumFields(rows, fields) {
  const totals = {}
  for (const field of fields) {
    let sum = null
    for (const row of rows) {
      const v = row[field]
      if (v != null) sum = (sum ?? 0) + v
    }
    totals[field] = sum
  }
  return totals
}

// Groups game-level (pro) or already season-level (college) rows by season,
// sums the given numeric fields per season, and appends a career total row.
function bySeasonWithCareerTotal(rows, seasonOf, fields) {
  const bySeason = new Map()
  for (const row of rows) {
    const season = seasonOf(row)
    if (!bySeason.has(season)) bySeason.set(season, [])
    bySeason.get(season).push(row)
  }
  const seasons = [...bySeason.keys()].sort((a, b) => a - b)
  const seasonRows = seasons.map((season) => ({
    season,
    games: bySeason.get(season).length,
    ...sumFields(bySeason.get(season), fields),
  }))
  const career = {
    season: 'Career',
    games: rows.length,
    ...sumFields(rows, fields),
    isTotal: true,
  }
  return seasonRows.length > 0 ? [...seasonRows, career] : []
}

function fmtNum(n) {
  return n == null ? '—' : n
}

function fmtPct(made, att) {
  if (!att) return '—'
  return `${((made / att) * 100).toFixed(1)}%`
}

function fmtRate(yards, attempts) {
  if (!attempts) return '—'
  return (yards / attempts).toFixed(1)
}

// A season-by-season stat table with a bolded career-total footer row.
// `columns` are {header, render(row)} pairs; `season` and `games` (labeled
// "G") columns are always included ahead of them.
function SeasonStatTable({ title, rows, columns }) {
  if (rows.length === 0) return null
  return (
    <div className="mb-6">
      <h3 className="mb-2 text-xs font-bold uppercase text-neutral-400">{title}</h3>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-neutral-500 dark:border-neutral-800">
              <th className="py-2 pr-3 font-medium">Season</th>
              <th className="px-2 py-2 text-right font-medium">G</th>
              {columns.map((col) => (
                <th key={col.header} className="px-2 py-2 text-right font-medium">
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.season}
                className={`border-b border-neutral-100 dark:border-neutral-900 ${
                  row.isTotal ? 'font-semibold text-neutral-900 dark:text-neutral-100' : ''
                }`}
              >
                <td className="py-1.5 pr-3">{row.season}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{row.games}</td>
                {columns.map((col) => (
                  <td key={col.header} className="px-2 py-1.5 text-right tabular-nums">
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const PASSING_FIELDS = ['completions', 'attempts', 'passing_yards', 'passing_tds', 'passing_interceptions']
const PASSING_COLUMNS = [
  { header: 'Cmp/Att', render: (r) => `${fmtNum(r.completions)}/${fmtNum(r.attempts)}` },
  { header: 'Cmp%', render: (r) => fmtPct(r.completions, r.attempts) },
  { header: 'Yds', render: (r) => fmtNum(r.passing_yards) },
  { header: 'TD', render: (r) => fmtNum(r.passing_tds) },
  { header: 'INT', render: (r) => fmtNum(r.passing_interceptions) },
]

const RUSH_REC_FIELDS = [
  'carries', 'rushing_yards', 'rushing_tds',
  'targets', 'receptions', 'receiving_yards', 'receiving_tds',
]
const RUSH_REC_COLUMNS = [
  { header: 'Car', render: (r) => fmtNum(r.carries) },
  { header: 'Rush Yds', render: (r) => fmtNum(r.rushing_yards) },
  { header: 'YPC', render: (r) => fmtRate(r.rushing_yards, r.carries) },
  { header: 'Rush TD', render: (r) => fmtNum(r.rushing_tds) },
  { header: 'Rec', render: (r) => fmtNum(r.receptions) },
  { header: 'Tgt', render: (r) => fmtNum(r.targets) },
  { header: 'Rec Yds', render: (r) => fmtNum(r.receiving_yards) },
  { header: 'Rec TD', render: (r) => fmtNum(r.receiving_tds) },
]

const DEFENSE_FIELDS = [
  'def_tackles_solo', 'def_tackles_with_assist', 'def_tackles_for_loss',
  'def_sacks', 'def_qb_hits', 'def_interceptions', 'def_pass_defended',
  'def_fumbles_forced', 'def_tds',
]
const DEFENSE_COLUMNS = [
  { header: 'Solo', render: (r) => fmtNum(r.def_tackles_solo) },
  { header: 'Ast', render: (r) => fmtNum(r.def_tackles_with_assist) },
  { header: 'TFL', render: (r) => fmtNum(r.def_tackles_for_loss) },
  { header: 'Sacks', render: (r) => fmtNum(r.def_sacks) },
  { header: 'QB Hits', render: (r) => fmtNum(r.def_qb_hits) },
  { header: 'INT', render: (r) => fmtNum(r.def_interceptions) },
  { header: 'PD', render: (r) => fmtNum(r.def_pass_defended) },
  { header: 'FF', render: (r) => fmtNum(r.def_fumbles_forced) },
  { header: 'TD', render: (r) => fmtNum(r.def_tds) },
]

const KICKING_FIELDS = ['fg_made', 'fg_att', 'fg_long', 'pat_made', 'pat_att']
const KICKING_COLUMNS = [
  { header: 'FG', render: (r) => `${fmtNum(r.fg_made)}/${fmtNum(r.fg_att)}` },
  { header: 'FG%', render: (r) => fmtPct(r.fg_made, r.fg_att) },
  { header: 'Long', render: (r) => fmtNum(r.fg_long) },
  { header: 'PAT', render: (r) => `${fmtNum(r.pat_made)}/${fmtNum(r.pat_att)}` },
]

const PUNTING_FIELDS = ['pt_att', 'pt_yards', 'pt_net_yards', 'pt_long']
const PUNTING_COLUMNS = [
  { header: 'Punts', render: (r) => fmtNum(r.pt_att) },
  { header: 'Yds', render: (r) => fmtNum(r.pt_yards) },
  { header: 'Avg', render: (r) => fmtRate(r.pt_yards, r.pt_att) },
  { header: 'Net Avg', render: (r) => fmtRate(r.pt_net_yards, r.pt_att) },
  { header: 'Long', render: (r) => fmtNum(r.pt_long) },
]

const RETURNS_FIELDS = ['punt_returns', 'punt_return_yards', 'kickoff_returns', 'kickoff_return_yards']
const RETURNS_COLUMNS = [
  { header: 'PR', render: (r) => fmtNum(r.punt_returns) },
  { header: 'PR Yds', render: (r) => fmtNum(r.punt_return_yards) },
  { header: 'KR', render: (r) => fmtNum(r.kickoff_returns) },
  { header: 'KR Yds', render: (r) => fmtNum(r.kickoff_return_yards) },
]

const COLLEGE_FIELDS = [
  'rush_att', 'rush_yds', 'rush_td', 'targets', 'receptions', 'rec_yds', 'rec_td',
  'pass_comp', 'pass_att', 'pass_yds', 'pass_td', 'pass_int',
  'def_int', 'def_sacks', 'def_ff', 'def_fr', 'def_pbu',
  'fg_made', 'fg_att',
]
const COLLEGE_PASSING_COLUMNS = [
  { header: 'Cmp/Att', render: (r) => `${fmtNum(r.pass_comp)}/${fmtNum(r.pass_att)}` },
  { header: 'Pass Yds', render: (r) => fmtNum(r.pass_yds) },
  { header: 'Pass TD', render: (r) => fmtNum(r.pass_td) },
  { header: 'INT', render: (r) => fmtNum(r.pass_int) },
]
const COLLEGE_RUSH_REC_COLUMNS = [
  { header: 'Car', render: (r) => fmtNum(r.rush_att) },
  { header: 'Rush Yds', render: (r) => fmtNum(r.rush_yds) },
  { header: 'Rush TD', render: (r) => fmtNum(r.rush_td) },
  { header: 'Rec', render: (r) => fmtNum(r.receptions) },
  { header: 'Tgt', render: (r) => fmtNum(r.targets) },
  { header: 'Rec Yds', render: (r) => fmtNum(r.rec_yds) },
  { header: 'Rec TD', render: (r) => fmtNum(r.rec_td) },
]
const COLLEGE_DEFENSE_COLUMNS = [
  { header: 'Sacks', render: (r) => fmtNum(r.def_sacks) },
  { header: 'INT', render: (r) => fmtNum(r.def_int) },
  { header: 'FF', render: (r) => fmtNum(r.def_ff) },
  { header: 'FR', render: (r) => fmtNum(r.def_fr) },
  { header: 'PBU', render: (r) => fmtNum(r.def_pbu) },
]
const COLLEGE_KICKING_COLUMNS = [
  { header: 'FG', render: (r) => `${fmtNum(r.fg_made)}/${fmtNum(r.fg_att)}` },
  { header: 'FG%', render: (r) => fmtPct(r.fg_made, r.fg_att) },
]

const INJURY_STATUS_STYLES = {
  Out: 'border-red-400 bg-red-50 text-red-600 dark:border-red-700 dark:bg-red-950/40 dark:text-red-400',
  Doubtful: 'border-orange-400 bg-orange-50 text-orange-600 dark:border-orange-700 dark:bg-orange-950/40 dark:text-orange-400',
  Questionable: 'border-yellow-400 bg-yellow-50 text-yellow-600 dark:border-yellow-700 dark:bg-yellow-950/40 dark:text-yellow-500',
}

export default function PlayerPage() {
  const { playerId } = useParams()
  const [player, setPlayer] = useState(null)
  const [depthChart, setDepthChart] = useState([])
  const [injury, setInjury] = useState(null)
  const [offenseRows, setOffenseRows] = useState([])
  const [defenseRows, setDefenseRows] = useState([])
  const [specialTeamsRows, setSpecialTeamsRows] = useState([])
  const [collegeSeasons, setCollegeSeasons] = useState([])
  const [collegeRoster, setCollegeRoster] = useState(null)
  const [teams, setTeams] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    Promise.all([
      supabase.from('players').select('*').eq('player_id', playerId).single(),
      supabase.from('depth_chart_ranks').select('*').eq('player_id', playerId).order('rank'),
      supabase.from('current_injury_report').select('*').eq('player_id', playerId).maybeSingle(),
      supabase
        .from('player_offense_stats')
        .select('*, games!inner(season, week, game_type)')
        .eq('player_id', playerId)
        .order('season', { foreignTable: 'games' })
        .order('week', { foreignTable: 'games' }),
      supabase
        .from('player_defense_stats')
        .select('*, games!inner(season, week, game_type)')
        .eq('player_id', playerId)
        .order('season', { foreignTable: 'games' })
        .order('week', { foreignTable: 'games' }),
      supabase
        .from('player_special_teams_stats')
        .select('*, games!inner(season, week, game_type)')
        .eq('player_id', playerId)
        .order('season', { foreignTable: 'games' })
        .order('week', { foreignTable: 'games' }),
      supabase.from('college_player_season_stats').select('*').eq('player_id', playerId).order('season'),
      supabase
        .from('college_rosters')
        .select('*')
        .eq('player_id', playerId)
        .order('season', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase.from('teams').select('team_abbr, team_name').in('team_abbr', CURRENT_TEAMS),
    ]).then(
      ([
        playerRes,
        depthRes,
        injuryRes,
        offenseRes,
        defenseRes,
        specialRes,
        collegeSeasonsRes,
        collegeRosterRes,
        teamsRes,
      ]) => {
        if (cancelled) return
        const err =
          playerRes.error ||
          depthRes.error ||
          injuryRes.error ||
          offenseRes.error ||
          defenseRes.error ||
          specialRes.error ||
          collegeSeasonsRes.error ||
          collegeRosterRes.error ||
          teamsRes.error
        if (err) {
          setError(err.message)
        } else {
          setPlayer(playerRes.data)
          setDepthChart(depthRes.data)
          setInjury(injuryRes.data)
          setOffenseRows(offenseRes.data)
          setDefenseRows(defenseRes.data)
          setSpecialTeamsRows(specialRes.data)
          setCollegeSeasons(collegeSeasonsRes.data)
          setCollegeRoster(collegeRosterRes.data)
          setTeams(teamsRes.data)
        }
        setLoading(false)
      },
    )

    return () => {
      cancelled = true
    }
  }, [playerId])

  const teamsByAbbr = useMemo(() => new Map(teams.map((t) => [t.team_abbr, t])), [teams])

  const passingSeasons = useMemo(
    () => bySeasonWithCareerTotal(offenseRows, (r) => r.games.season, PASSING_FIELDS),
    [offenseRows],
  )
  const rushRecSeasons = useMemo(
    () => bySeasonWithCareerTotal(offenseRows, (r) => r.games.season, RUSH_REC_FIELDS),
    [offenseRows],
  )
  const defenseSeasons = useMemo(
    () => bySeasonWithCareerTotal(defenseRows, (r) => r.games.season, DEFENSE_FIELDS),
    [defenseRows],
  )
  const kickingSeasons = useMemo(
    () => bySeasonWithCareerTotal(specialTeamsRows, (r) => r.games.season, KICKING_FIELDS),
    [specialTeamsRows],
  )
  const puntingSeasons = useMemo(
    () => bySeasonWithCareerTotal(specialTeamsRows, (r) => r.games.season, PUNTING_FIELDS),
    [specialTeamsRows],
  )
  const returnsSeasons = useMemo(
    () => bySeasonWithCareerTotal(specialTeamsRows, (r) => r.games.season, RETURNS_FIELDS),
    [specialTeamsRows],
  )
  const collegeCareer = useMemo(
    () => bySeasonWithCareerTotal(collegeSeasons, (r) => r.season, COLLEGE_FIELDS),
    [collegeSeasons],
  )

  const hasPassing = passingSeasons.some((r) => (r.attempts ?? 0) > 0)
  const hasRushRec = rushRecSeasons.some((r) => (r.carries ?? 0) > 0 || (r.targets ?? 0) > 0)
  const hasDefense = defenseSeasons.length > 0
  const hasKicking = kickingSeasons.some((r) => (r.fg_att ?? 0) > 0 || (r.pat_att ?? 0) > 0)
  const hasPunting = puntingSeasons.some((r) => (r.pt_att ?? 0) > 0)
  const hasReturns = returnsSeasons.some((r) => (r.punt_returns ?? 0) > 0 || (r.kickoff_returns ?? 0) > 0)

  const hasCollegePassing = collegeCareer.some((r) => (r.pass_att ?? 0) > 0)
  const hasCollegeRushRec = collegeCareer.some((r) => (r.rush_att ?? 0) > 0 || (r.targets ?? 0) > 0)
  const hasCollegeDefense = collegeCareer.some(
    (r) => (r.def_sacks ?? 0) > 0 || (r.def_int ?? 0) > 0 || (r.def_ff ?? 0) > 0 || (r.def_fr ?? 0) > 0 || (r.def_pbu ?? 0) > 0,
  )
  const hasCollegeKicking = collegeCareer.some((r) => (r.fg_att ?? 0) > 0)

  if (loading) return <p className="p-6 text-sm text-neutral-500">Loading…</p>
  if (error) return <p className="p-6 text-sm text-red-500">Error: {error}</p>
  if (!player) return <p className="p-6 text-sm text-neutral-500">Player not found.</p>

  // Depth chart is a current-snapshot table (not season-scoped), so a
  // player's row there reflects the team/role they hold right now.
  const currentTeamAbbr = depthChart[0]?.team ?? injury?.team ?? null
  const currentTeam = currentTeamAbbr ? teamsByAbbr.get(currentTeamAbbr) : null
  const injuryStyle = injury?.report_status ? INJURY_STATUS_STYLES[injury.report_status] : null
  const photoUrl = player.headshot_url || collegeRoster?.headshot_url || null

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6">
      {/* Header: photo, name, position/team, bio */}
      <div className="mb-8 flex flex-col gap-6 sm:flex-row sm:items-start">
        {photoUrl ? (
          <img
            src={photoUrl}
            alt={player.display_name}
            className="h-32 w-32 shrink-0 rounded-lg border border-neutral-200 object-cover dark:border-neutral-800"
          />
        ) : (
          <div className="flex h-32 w-32 shrink-0 items-center justify-center rounded-lg border border-neutral-200 bg-neutral-100 text-3xl font-semibold text-neutral-400 dark:border-neutral-800 dark:bg-neutral-800 dark:text-neutral-500">
            {initials(player.display_name)}
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold text-neutral-900 dark:text-neutral-100">
              {player.display_name}
            </h1>
            {player.jersey_number != null && (
              <span className="text-lg text-neutral-400">#{player.jersey_number}</span>
            )}
          </div>

          <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-neutral-600 dark:text-neutral-300">
            {depthChart[0] && <span className="font-medium">{depthChart[0].position_abbr}</span>}
            {!depthChart[0] && player.position && <span className="font-medium">{player.position}</span>}
            {currentTeamAbbr && (
              <Link to={`/team/${currentTeamAbbr}`} className="flex items-center gap-1.5 hover:underline">
                <img
                  src={`${import.meta.env.BASE_URL}logos/${currentTeamAbbr}.png`}
                  alt={currentTeamAbbr}
                  className="h-5 w-5 object-contain"
                />
                {currentTeam?.team_name ?? currentTeamAbbr}
              </Link>
            )}
            {depthChart[0] && (
              <span className="rounded border border-neutral-200 px-1.5 py-0.5 text-xs text-neutral-500 dark:border-neutral-800">
                {depthChart[0].position_abbr}
                {depthChart[0].rank}
              </span>
            )}
            {injuryStyle && (
              <span className={`rounded border px-1.5 py-0.5 text-xs font-medium ${injuryStyle}`}>
                {injury.report_status}
                {injury.report_primary_injury ? ` — ${injury.report_primary_injury}` : ''}
              </span>
            )}
          </div>

          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-neutral-400">Height</dt>
              <dd className="text-neutral-800 dark:text-neutral-200">{fmtHeight(player.height)}</dd>
            </div>
            <div>
              <dt className="text-neutral-400">Weight</dt>
              <dd className="text-neutral-800 dark:text-neutral-200">{fmtWeight(player.weight)}</dd>
            </div>
            <div>
              <dt className="text-neutral-400">College</dt>
              <dd className="text-neutral-800 dark:text-neutral-200">{player.college_name ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-neutral-400">Born</dt>
              <dd className="text-neutral-800 dark:text-neutral-200">
                {fmtBirthDate(player.birth_date) ?? '—'}
                {ageFromBirthDate(player.birth_date) != null ? ` (${ageFromBirthDate(player.birth_date)})` : ''}
              </dd>
            </div>
            <div>
              <dt className="text-neutral-400">Rookie Season</dt>
              <dd className="text-neutral-800 dark:text-neutral-200">{player.rookie_season ?? '—'}</dd>
            </div>
          </dl>
        </div>
      </div>

      {/* NFL career */}
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">NFL Career</h2>
      {!hasPassing && !hasRushRec && !hasDefense && !hasKicking && !hasPunting && !hasReturns && (
        <p className="mb-6 text-sm text-neutral-400">No NFL stats on record.</p>
      )}
      {hasPassing && <SeasonStatTable title="Passing" rows={passingSeasons} columns={PASSING_COLUMNS} />}
      {hasRushRec && <SeasonStatTable title="Rushing & Receiving" rows={rushRecSeasons} columns={RUSH_REC_COLUMNS} />}
      {hasDefense && <SeasonStatTable title="Defense" rows={defenseSeasons} columns={DEFENSE_COLUMNS} />}
      {hasKicking && <SeasonStatTable title="Kicking" rows={kickingSeasons} columns={KICKING_COLUMNS} />}
      {hasPunting && <SeasonStatTable title="Punting" rows={puntingSeasons} columns={PUNTING_COLUMNS} />}
      {hasReturns && <SeasonStatTable title="Returns" rows={returnsSeasons} columns={RETURNS_COLUMNS} />}

      {/* College career */}
      {collegeCareer.length > 0 && (
        <>
          <h2 className="mb-2 mt-4 text-sm font-semibold uppercase tracking-wide text-neutral-500">
            College Career
          </h2>
          {hasCollegePassing && (
            <SeasonStatTable title="Passing" rows={collegeCareer} columns={COLLEGE_PASSING_COLUMNS} />
          )}
          {hasCollegeRushRec && (
            <SeasonStatTable title="Rushing & Receiving" rows={collegeCareer} columns={COLLEGE_RUSH_REC_COLUMNS} />
          )}
          {hasCollegeDefense && (
            <SeasonStatTable title="Defense" rows={collegeCareer} columns={COLLEGE_DEFENSE_COLUMNS} />
          )}
          {hasCollegeKicking && (
            <SeasonStatTable title="Kicking" rows={collegeCareer} columns={COLLEGE_KICKING_COLUMNS} />
          )}
        </>
      )}
    </div>
  )
}
