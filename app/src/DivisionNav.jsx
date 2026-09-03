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
    <nav className="hidden w-16 shrink-0 border-r border-neutral-200 px-2 py-4 lg:block dark:border-neutral-800">
      {CONFERENCES.map((conf) => (
        <div
          key={conf}
          className={`mb-6 rounded-lg border px-1.5 pb-3 pt-1.5 ${CONFERENCE_BORDER[conf] ?? 'border-neutral-300 dark:border-neutral-700'}`}
        >
          <h2 className={`mb-2 text-center text-base font-bold uppercase tracking-wide ${CONFERENCE_TEXT[conf] ?? 'text-neutral-500'}`}>
            {conf}
          </h2>
          {DIVISION_ORDER.map((div) => {
            const teamAbbrs = (grouped[conf]?.[div] ?? []).sort()
            if (teamAbbrs.length === 0) return null
            return (
              <div key={div} className="mb-3 last:mb-0">
                <h3 className="mb-1 text-center text-xs font-bold text-neutral-400">{div}</h3>
                <div className="grid grid-cols-1 gap-1.5">
                  {teamAbbrs.map((abbr) => (
                    <Link key={abbr} to={`/team/${abbr}`} title={abbr}>
                      <img
                        src={`${import.meta.env.BASE_URL}logos/${abbr}.png`}
                        alt={abbr}
                        className="h-9 w-9 object-contain"
                      />
                    </Link>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      ))}
    </nav>
  )
}
