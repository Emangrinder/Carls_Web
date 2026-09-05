import { HashRouter, Routes, Route } from 'react-router-dom'
import TeamRibbon from './TeamRibbon'
import TeamStatsTable from './TeamStatsTable'
import TeamPage from './TeamPage'
import MatchesPage from './MatchesPage'
import GamePage from './GamePage'
import DivisionNav from './DivisionNav'
import Footer from './Footer'
import PlayerPage from './PlayerPage'
import FantasyRulesPage from './FantasyRulesPage'
import FantasyScoresPage from './FantasyScoresPage'

function App() {
  return (
    <HashRouter>
      <div className="flex min-h-screen flex-col bg-neutral-50 dark:bg-neutral-900">
        <TeamRibbon />
        <div className="flex flex-1">
          <DivisionNav />
          <div className="min-w-0 flex-1">
            <Routes>
              <Route path="/" element={<TeamStatsTable />} />
              <Route path="/matches" element={<MatchesPage />} />
              <Route path="/matches/:gameId" element={<GamePage />} />
              <Route path="/team/:teamAbbr" element={<TeamPage />} />
              <Route path="/player/:playerId" element={<PlayerPage />} />
              <Route path="/rules" element={<FantasyRulesPage />} />
              <Route path="/scores" element={<FantasyScoresPage />} />
            </Routes>
          </div>
        </div>
        <Footer />
      </div>
    </HashRouter>
  )
}

export default App
