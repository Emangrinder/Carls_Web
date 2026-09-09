import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from './supabaseClient'
import { CURRENT_TEAMS } from './constants'

const CONFERENCES = ['AFC', 'NFC']
const DIVISION_ORDER = ['East', 'North', 'South', 'West']
const CONFERENCE_TEXT = {
  AFC: 'text-red-600 dark:text-red-400',
  NFC: 'text-blue-600 dark:text-blue-400',
}
const CONFERENCE_BORDER = {
  AFC: 'border-red-600 dark:border-red-400',
  NFC: 'border-blue-600 dark:border-blue-400',
}

export default function DivisionNav() {
  const [teams, setTeams] = useState([])
  // Three independent hover levels -- conference and division are keyed
  // strings (so sibling divisions/conferences never light up together),
  // team is just the abbr since it's already scoped by which division
  // renders it.
  const [hoveredConf, setHoveredConf] = useState(null)
  const [hoveredDivKey, setHoveredDivKey] = useState(null)
  const [hoveredTeam, setHoveredTeam] = useState(null)

  useEffect(() => {
    supabase
      .from('teams')
      .select('team_abbr, conference, division')
      .not('conference', 'is', null)
      .then(({ data, error }) => {
        if (!error) setTeams(data)
      })
  }, [])

  // conference -> division suffix (East/North/South/West) -> [team_abbr]
  const grouped = teams.reduce((acc, t) => {
    if (!t.conference || !t.division || !CURRENT_TEAMS.includes(t.team_abbr)) return acc
    const divSuffix = t.division.replace(`${t.conference} `, '')
    acc[t.conference] ??= {}
    ;(acc[t.conference][divSuffix] ??= []).push(t.team_abbr)
    return acc
  }, {})

  return (
    <nav className="hidden w-20 shrink-0 border-r border-neutral-200 px-2 py-4 lg:block dark:border-neutral-800">
      {CONFERENCES.map((conf) => (
        <div
          key={conf}
          className={`mb-6 rounded-lg border px-1.5 pb-3 pt-1.5 ${CONFERENCE_BORDER[conf] ?? 'border-neutral-300 dark:border-neutral-700'}`}
          onMouseEnter={() => setHoveredConf(conf)}
          onMouseLeave={() => setHoveredConf(null)}
        >
          <h2
            className={`mb-2 text-center text-base font-bold uppercase tracking-wide transition-transform duration-150 ${CONFERENCE_TEXT[conf] ?? 'text-neutral-500'} ${
              hoveredConf === conf ? 'scale-105' : ''
            }`}
          >
            {conf}
          </h2>
          {DIVISION_ORDER.map((div) => {
            const teamAbbrs = (grouped[conf]?.[div] ?? []).sort()
            if (teamAbbrs.length === 0) return null
            const divKey = `${conf}-${div}`
            const isDivHovered = hoveredDivKey === divKey
            return (
              <div
                key={div}
                className="mb-3 last:mb-0"
                onMouseEnter={() => setHoveredDivKey(divKey)}
                onMouseLeave={() => setHoveredDivKey(null)}
              >
                <h3
                  className={`mb-1 text-center text-xs font-bold text-neutral-400 transition-transform duration-150 ${
                    isDivHovered ? 'scale-110' : ''
                  }`}
                >
                  {div}
                </h3>
                <div className="grid grid-cols-1 gap-1.5">
                  {teamAbbrs.map((abbr) => {
                    const isTeamHovered = hoveredTeam === abbr
                    return (
                      <Link
                        key={abbr}
                        to={`/team/${abbr}`}
                        title={abbr}
                        className="flex items-center justify-center"
                        onMouseEnter={() => setHoveredTeam(abbr)}
                        onMouseLeave={() => setHoveredTeam(null)}
                      >
                        <img
                          src={`${import.meta.env.BASE_URL}logos/${abbr}.png`}
                          alt={abbr}
                          className={`h-9 w-9 object-contain transition-transform duration-150 ${
                            isTeamHovered ? 'relative z-10 scale-125' : isDivHovered ? 'scale-105' : ''
                          }`}
                        />
                      </Link>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      ))}
    </nav>
  )
}
